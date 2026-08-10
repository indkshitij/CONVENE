import { profiles, userIntents, type NewUserIntent, type UserIntent } from "@convene/db";
import { intents as intentsValidation } from "@convene/validation";
import { Injectable, Optional } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { and, desc, eq, lt, ne } from "drizzle-orm";
import type { z } from "zod";
import {
  ConflictAppError,
  NotFoundAppError,
  PaymentRequiredAppError,
  ValidationAppError,
} from "../../common/errors/app-error";
import { type Clock, systemClock } from "../../common/clock";
import { PostgresService } from "../../infra/postgres/postgres.service";
import { INTENT_CHANGED_EVENT } from "./intent-events";
import { checkPrerequisites, type PrerequisiteFacts } from "./intent-prerequisites";
import { getIntentLimit } from "./plan-limits";

export type CreateIntentInput = z.infer<typeof intentsValidation.createIntentSchema>;
export type UpdateIntentInput = z.infer<typeof intentsValidation.updateIntentSchema>;
export type RenewIntentInput = z.infer<typeof intentsValidation.renewIntentSchema>;

export interface IntentResponse {
  id: string;
  type: string;
  detail: string | null;
  metadata: unknown;
  is_primary: boolean;
  is_paused: boolean;
  status: string;
  expires_at: string;
  renewed_count: number;
  created_at: string;
}

export interface CreateIntentResult {
  intent: IntentResponse;
  active_count: number;
  plan_limit: number;
  // Real candidate-count computation needs the discovery/matching
  // pipeline (P9.3/P13.x), which doesn't exist yet — honestly reporting
  // zero rather than fabricating a plausible-looking number, same
  // principle the design doc applies to the onboarding live-counter
  // ("must be real ... never fabricated"). Wired up once that pipeline
  // exists.
  match_preview: { potential_matches: number; nearby: number };
}

const EXPIRES_IN_DAYS_MS = 24 * 60 * 60 * 1000;

// PRD §10.4 endpoints 23/24. §10.4.6's literal route contracts
// (`/api/v1/intents`, no `/me` segment — the caller's own intents are
// always implied by the auth context) are treated as authoritative over
// the terser master endpoint table's "CRUD /me/intents" shorthand, same
// precedent established for profile/verification routes.
@Injectable()
export class IntentsService {
  constructor(
    private readonly postgres: PostgresService,
    @Optional() private readonly clock: Clock = systemClock,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  async listIntents(userId: string, includeArchived: boolean): Promise<IntentResponse[]> {
    await this.expireStaleIntents(userId);
    const rows = await this.postgres.db
      .select()
      .from(userIntents)
      .where(
        includeArchived
          ? eq(userIntents.userId, userId)
          : and(eq(userIntents.userId, userId), eq(userIntents.status, "active")),
      )
      .orderBy(desc(userIntents.createdAt));
    return rows.map((r) => this.toResponse(r));
  }

  // PRD §10.4.6 POST /intents. Enforces, in order: BR-INT-01 (mandatory
  // expiry, via the schema), duplicate-type (validation table), BR-INT-02
  // (plan limit), BR-INT-05 (prerequisites) — the DB-level partial unique
  // indexes (uq_intent_active_type, uq_intent_primary) are the last line
  // of defence against a race between this check and the insert, not the
  // only one.
  async createIntent(
    userId: string,
    plan: string,
    input: CreateIntentInput,
  ): Promise<CreateIntentResult> {
    await this.expireStaleIntents(userId);

    const activeRows = await this.postgres.db
      .select()
      .from(userIntents)
      .where(and(eq(userIntents.userId, userId), eq(userIntents.status, "active")));

    if (activeRows.some((r) => r.type === input.type)) {
      throw new ConflictAppError("DUPLICATE_INTENT", "You already have this intent active.", {
        field: "type",
      });
    }

    const limit = getIntentLimit(plan);
    if (activeRows.length >= limit) {
      throw new PaymentRequiredAppError("PLAN_LIMIT_REACHED", "Upgrade to add more intents.", {
        details: { limit },
      });
    }

    const facts = await this.gatherPrerequisiteFacts(userId);
    const prerequisites = checkPrerequisites(input.type, facts);
    if (!prerequisites.met) {
      throw new ValidationAppError(
        "INTENT_PREREQUISITE_UNMET",
        "This intent has unmet prerequisites.",
        {
          details: { unmet: prerequisites.unmet },
        },
      );
    }

    // BR-INT-03: "Exactly one intent may be is_primary ... auto-managed
    // server-side." The very first active intent is always primary
    // (nothing to be primary *over* yet) regardless of what the caller
    // requested; otherwise the caller's own is_primary flag decides.
    const wantsPrimary = activeRows.length === 0 || input.is_primary === true;

    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + input.expires_in_days * EXPIRES_IN_DAYS_MS);

    const created = await this.postgres.db.transaction(async (tx) => {
      if (wantsPrimary) {
        await tx
          .update(userIntents)
          .set({ isPrimary: false })
          .where(
            and(
              eq(userIntents.userId, userId),
              eq(userIntents.status, "active"),
              eq(userIntents.isPrimary, true),
            ),
          );
      }

      const values: NewUserIntent = {
        userId,
        type: input.type,
        detail: input.detail ?? null,
        metadata: input.metadata ?? {},
        isPrimary: wantsPrimary,
        expiresAt,
      };
      const [row] = await tx.insert(userIntents).values(values).returning();
      if (!row) throw new Error("IntentsService: insert returned no row");
      return row;
    });

    this.events?.emit(INTENT_CHANGED_EVENT, { userId, intentId: created.id, type: created.type });

    return {
      intent: this.toResponse(created),
      active_count: activeRows.length + 1,
      plan_limit: limit,
      match_preview: { potential_matches: 0, nearby: 0 },
    };
  }

  async updateIntent(
    userId: string,
    intentId: string,
    patch: UpdateIntentInput,
  ): Promise<IntentResponse> {
    const [existing] = await this.postgres.db
      .select()
      .from(userIntents)
      .where(and(eq(userIntents.id, intentId), eq(userIntents.userId, userId)))
      .limit(1);
    if (!existing)
      throw new NotFoundAppError("INTENT_NOT_FOUND", "This intent could not be found.");

    const columnUpdates: Partial<NewUserIntent> = { updatedAt: this.clock.now() };
    if (patch.detail !== undefined) columnUpdates.detail = patch.detail;
    if (patch.expires_in_days !== undefined) {
      columnUpdates.expiresAt = new Date(
        this.clock.now().getTime() + patch.expires_in_days * EXPIRES_IN_DAYS_MS,
      );
    }
    if (patch.is_paused !== undefined) columnUpdates.isPaused = patch.is_paused;
    if (patch.metadata !== undefined) columnUpdates.metadata = patch.metadata;

    const [updated] = await this.postgres.db
      .update(userIntents)
      .set(columnUpdates)
      .where(and(eq(userIntents.id, intentId), eq(userIntents.userId, userId)))
      .returning();
    if (!updated) throw new NotFoundAppError("INTENT_NOT_FOUND", "This intent could not be found.");

    this.events?.emit(INTENT_CHANGED_EVENT, { userId, intentId: updated.id, type: updated.type });
    return this.toResponse(updated);
  }

  // PRD §10.4.4 "renew (extend expiry)" — scoped to active intents only;
  // an archived intent past its 12-month prior window is effectively gone
  // and re-declaring it is a new POST /intents, not a renewal.
  async renewIntent(
    userId: string,
    intentId: string,
    input: RenewIntentInput,
  ): Promise<IntentResponse> {
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + input.expires_in_days * EXPIRES_IN_DAYS_MS);

    const [updated] = await this.postgres.db
      .update(userIntents)
      .set({ expiresAt, updatedAt: now })
      .where(
        and(
          eq(userIntents.id, intentId),
          eq(userIntents.userId, userId),
          eq(userIntents.status, "active"),
        ),
      )
      .returning();
    // Drizzle's `set` can't express "increment" declaratively alongside a
    // literal object in one call the way raw SQL can — renewedCount is
    // read-modify-written in a second, ownership-scoped statement instead
    // of a subquery, accepting the small race window (double-renewing in
    // the same instant only miscounts an analytics number, never expiry
    // correctness, which the first update already committed).
    if (!updated) throw new NotFoundAppError("INTENT_NOT_FOUND", "This intent could not be found.");

    const [withCount] = await this.postgres.db
      .update(userIntents)
      .set({ renewedCount: updated.renewedCount + 1 })
      .where(eq(userIntents.id, intentId))
      .returning();

    const result = withCount ?? updated;
    this.events?.emit(INTENT_CHANGED_EVENT, { userId, intentId: result.id, type: result.type });
    return this.toResponse(result);
  }

  // BR-INT-03's invariant enforced explicitly here too (not just via the
  // DB partial unique index) so the response is consistent within the
  // same request.
  async setPrimary(userId: string, intentId: string): Promise<IntentResponse> {
    const updated = await this.postgres.db.transaction(async (tx) => {
      await tx
        .update(userIntents)
        .set({ isPrimary: false })
        .where(
          and(
            eq(userIntents.userId, userId),
            eq(userIntents.status, "active"),
            ne(userIntents.id, intentId),
          ),
        );

      const [row] = await tx
        .update(userIntents)
        .set({ isPrimary: true, updatedAt: this.clock.now() })
        .where(
          and(
            eq(userIntents.id, intentId),
            eq(userIntents.userId, userId),
            eq(userIntents.status, "active"),
          ),
        )
        .returning();
      return row;
    });
    if (!updated) throw new NotFoundAppError("INTENT_NOT_FOUND", "This intent could not be found.");

    this.events?.emit(INTENT_CHANGED_EVENT, { userId, intentId: updated.id, type: updated.type });
    return this.toResponse(updated);
  }

  // BR-INT-03's invariant, other direction: deleting the primary intent
  // while other active intents remain must not leave zero primaries.
  // Promotes the most recently created remaining active intent — an
  // assumption (the PRD doesn't name a tiebreak), flagged here and in the
  // PR description.
  async deleteIntent(userId: string, intentId: string): Promise<void> {
    const deleted = await this.postgres.db
      .delete(userIntents)
      .where(and(eq(userIntents.id, intentId), eq(userIntents.userId, userId)))
      .returning();
    if (deleted.length === 0)
      throw new NotFoundAppError("INTENT_NOT_FOUND", "This intent could not be found.");

    const removed = deleted[0]!;
    if (removed.isPrimary && removed.status === "active") {
      const [nextPrimary] = await this.postgres.db
        .select()
        .from(userIntents)
        .where(and(eq(userIntents.userId, userId), eq(userIntents.status, "active")))
        .orderBy(desc(userIntents.createdAt))
        .limit(1);
      if (nextPrimary) {
        await this.postgres.db
          .update(userIntents)
          .set({ isPrimary: true })
          .where(eq(userIntents.id, nextPrimary.id));
      }
    }

    this.events?.emit(INTENT_CHANGED_EVENT, { userId, intentId, type: removed.type });
  }

  // BR-INT-06: "On expiry the intent moves to archived (not deleted) and
  // stops affecting matching." Applied lazily whenever this user's
  // intents are read or written, rather than a proactive scheduled sweep
  // — a dedicated worker (mirroring workers/embedding-refresh.worker.ts's
  // pattern) plus the T-3-day renewal-prompt notification are deferred;
  // neither exists yet and this prompt's endpoints are the only thing
  // that reads user_intents today, so lazy transition can't leave a stale
  // row visible to anything.
  private async expireStaleIntents(userId: string): Promise<void> {
    await this.postgres.db
      .update(userIntents)
      .set({ status: "archived", isPrimary: false })
      .where(
        and(
          eq(userIntents.userId, userId),
          eq(userIntents.status, "active"),
          lt(userIntents.expiresAt, this.clock.now()),
        ),
      );
  }

  private async gatherPrerequisiteFacts(userId: string): Promise<PrerequisiteFacts> {
    const [profile] = await this.postgres.db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    return {
      hasCompanyName: !!profile?.companyName,
      verificationLevel: profile?.verificationLevel ?? 0,
      yearsExperience: profile ? Number(profile.yearsExperience) : 0,
    };
  }

  private toResponse(row: UserIntent): IntentResponse {
    return {
      id: row.id,
      type: row.type,
      detail: row.detail,
      metadata: row.metadata,
      is_primary: row.isPrimary,
      is_paused: row.isPaused,
      status: row.status,
      expires_at: row.expiresAt.toISOString(),
      renewed_count: row.renewedCount,
      created_at: row.createdAt.toISOString(),
    };
  }
}
