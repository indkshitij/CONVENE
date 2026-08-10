import {
  availabilityLive,
  availabilitySessionIntents,
  availabilitySessions,
  type AvailabilitySession,
  type NewAvailabilitySession,
} from "@convene/db";
import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { PostgresService } from "../../../infra/postgres/postgres.service";

export interface CreateSessionParams {
  userId: string;
  state: "available_now" | "busy" | "away" | "invisible";
  durationMinutes: number | null;
  expiresAt: Date | null;
  note: string | null;
  source: string | null;
  intentIds: string[];
  geohash5: string | null;
  cityId: number | null;
  now: Date;
}

export interface SessionSummary {
  matchesViewed: number;
  requestsSent: number;
  conversationsStarted: number;
  durationActualMinutes: number;
}

const UNIQUE_VIOLATION = "23505";

export class UniqueActiveSessionViolation extends Error {}

// PRD §10.3.9. The BR-AVAIL-03 "at most one active session" guarantee is
// the `uq_avail_active_per_user` partial unique index, not the
// end-then-insert ordering below — that ordering is only the UX-level
// "supersede" behaviour. A genuine race (two concurrent createSession
// calls for the same user) surfaces as a Postgres unique-violation on the
// INSERT, translated here into UniqueActiveSessionViolation rather than
// silently succeeding twice.
@Injectable()
export class AvailabilityRepository {
  constructor(private readonly postgres: PostgresService) {}

  async getActiveSession(userId: string): Promise<AvailabilitySession | null> {
    const [row] = await this.postgres.db
      .select()
      .from(availabilitySessions)
      .where(and(eq(availabilitySessions.userId, userId), isNull(availabilitySessions.endedAt)))
      .limit(1);
    return row ?? null;
  }

  async createSession(params: CreateSessionParams): Promise<AvailabilitySession> {
    try {
      return await this.postgres.db.transaction(async (tx) => {
        // BR-AVAIL-03: ends whatever was active — this is the "supersede"
        // UX, not the safety guarantee (see class comment).
        await tx
          .update(availabilitySessions)
          .set({ endedAt: params.now, endReason: "superseded" })
          .where(
            and(
              eq(availabilitySessions.userId, params.userId),
              isNull(availabilitySessions.endedAt),
            ),
          );

        const values: NewAvailabilitySession = {
          userId: params.userId,
          state: params.state,
          startedAt: params.now,
          expiresAt: params.expiresAt,
          durationMinutes: params.durationMinutes,
          note: params.note,
          source: params.source,
        };
        const [created] = await tx.insert(availabilitySessions).values(values).returning();
        if (!created) throw new Error("AvailabilityRepository: insert returned no row");

        if (params.intentIds.length > 0) {
          await tx
            .insert(availabilitySessionIntents)
            .values(params.intentIds.map((intentId) => ({ sessionId: created.id, intentId })));
        }

        // §16.4: mirror into availability_live in the same transaction
        // boundary as the durable session row (the Redis mirror happens
        // separately, right after commit — see availability.service.ts).
        await tx
          .insert(availabilityLive)
          .values({
            userId: params.userId,
            state: params.state,
            sessionId: created.id,
            expiresAt: params.expiresAt,
            intentIds: params.intentIds.length > 0 ? params.intentIds : null,
            geohash5: params.geohash5,
            cityId: params.cityId,
            updatedAt: params.now,
          })
          .onConflictDoUpdate({
            target: availabilityLive.userId,
            set: {
              state: params.state,
              sessionId: created.id,
              expiresAt: params.expiresAt,
              intentIds: params.intentIds.length > 0 ? params.intentIds : null,
              geohash5: params.geohash5,
              cityId: params.cityId,
              updatedAt: params.now,
            },
          });

        return created;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new UniqueActiveSessionViolation();
      throw error;
    }
  }

  // BR-AVAIL-05: cumulative 240 min AND max 3 extensions — both checked
  // by the caller (availability.service.ts) before calling this; the
  // extensions_used <= 3 CHECK constraint is the DB-level backstop.
  async extendSession(
    sessionId: string,
    userId: string,
    newExpiresAt: Date,
    now: Date,
  ): Promise<AvailabilitySession | null> {
    const [updated] = await this.postgres.db
      .update(availabilitySessions)
      .set({
        expiresAt: newExpiresAt,
        extensionsUsed: sql`${availabilitySessions.extensionsUsed} + 1`,
      })
      .where(
        and(
          eq(availabilitySessions.id, sessionId),
          eq(availabilitySessions.userId, userId),
          isNull(availabilitySessions.endedAt),
        ),
      )
      .returning();
    if (!updated) return null;

    await this.postgres.db
      .update(availabilityLive)
      .set({ expiresAt: newExpiresAt, updatedAt: now })
      .where(eq(availabilityLive.userId, userId));

    return updated;
  }

  async endSession(
    sessionId: string,
    userId: string,
    now: Date,
    reason: "manual" | "expired" | "disconnected" = "manual",
  ): Promise<AvailabilitySession | null> {
    const [ended] = await this.postgres.db
      .update(availabilitySessions)
      .set({ endedAt: now, endReason: reason })
      .where(
        and(
          eq(availabilitySessions.id, sessionId),
          eq(availabilitySessions.userId, userId),
          isNull(availabilitySessions.endedAt),
        ),
      )
      .returning();
    if (!ended) return null;

    await this.postgres.db.delete(availabilityLive).where(eq(availabilityLive.userId, userId));

    return ended;
  }

  // P10.2's sweeper (§10.3.10 "braces"): finds every available_now session
  // whose expiry has passed and hasn't ended yet — idx_avail_live_expiry
  // exists specifically for this query.
  async findExpiredSessions(now: Date): Promise<AvailabilitySession[]> {
    return this.postgres.db
      .select()
      .from(availabilitySessions)
      .where(
        and(
          eq(availabilitySessions.state, "available_now"),
          isNull(availabilitySessions.endedAt),
          lt(availabilitySessions.expiresAt, now),
        ),
      );
  }

  // Idempotent by sessionId alone — both the sweeper and the Redis
  // keyspace listener (§10.3.10's independent "belt") call this same
  // method, and only whichever call actually flips ended_at (the
  // `WHERE ended_at IS NULL` guard) gets a non-null row back, so exactly
  // one of two racing calls ever proceeds to emit an event.
  async expireSessionById(
    sessionId: string,
    now: Date,
    reason: "expired" | "disconnected" = "expired",
  ): Promise<AvailabilitySession | null> {
    const [ended] = await this.postgres.db
      .update(availabilitySessions)
      .set({ endedAt: now, endReason: reason })
      .where(and(eq(availabilitySessions.id, sessionId), isNull(availabilitySessions.endedAt)))
      .returning();
    if (!ended) return null;

    await this.postgres.db
      .delete(availabilityLive)
      .where(eq(availabilityLive.userId, ended.userId));
    return ended;
  }

  // BR-AVAIL-06: sessions within `withinMs` of expiring, still active.
  async findSessionsExpiringWithin(now: Date, withinMs: number): Promise<AvailabilitySession[]> {
    const horizon = new Date(now.getTime() + withinMs);
    return this.postgres.db
      .select()
      .from(availabilitySessions)
      .where(
        and(
          eq(availabilitySessions.state, "available_now"),
          isNull(availabilitySessions.endedAt),
          lt(availabilitySessions.expiresAt, horizon),
          gte(availabilitySessions.expiresAt, now),
        ),
      );
  }

  async findActiveAvailableNowSessions(): Promise<AvailabilitySession[]> {
    return this.postgres.db
      .select()
      .from(availabilitySessions)
      .where(
        and(eq(availabilitySessions.state, "available_now"), isNull(availabilitySessions.endedAt)),
      );
  }

  // BR-AVAIL-07/recovery: an in-place state mutation on the *same* session
  // row (not end-and-recreate) — the Gherkin scenario requires the
  // original expires_at to survive an Away detour untouched, which only
  // holds if this is the same row throughout.
  async setSessionState(
    sessionId: string,
    state: "available_now" | "away",
    now: Date,
  ): Promise<AvailabilitySession | null> {
    const [updated] = await this.postgres.db
      .update(availabilitySessions)
      .set({ state })
      .where(and(eq(availabilitySessions.id, sessionId), isNull(availabilitySessions.endedAt)))
      .returning();
    if (!updated) return null;

    await this.postgres.db
      .update(availabilityLive)
      .set({ state, updatedAt: now })
      .where(eq(availabilityLive.userId, updated.userId));
    return updated;
  }

  async getHistory(
    userId: string,
    from: Date | null,
    to: Date | null,
  ): Promise<AvailabilitySession[]> {
    const conditions = [eq(availabilitySessions.userId, userId)];
    if (from) conditions.push(gte(availabilitySessions.startedAt, from));
    if (to) conditions.push(lte(availabilitySessions.startedAt, to));
    return this.postgres.db
      .select()
      .from(availabilitySessions)
      .where(and(...conditions))
      .orderBy(desc(availabilitySessions.startedAt));
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === UNIQUE_VIOLATION
    );
  }
}
