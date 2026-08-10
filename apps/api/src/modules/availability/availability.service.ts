import {
  availabilitySessionIntents,
  availabilitySessions,
  profiles,
  userIntents,
  type AvailabilitySession,
} from "@convene/db";
import { availability as availabilityValidation } from "@convene/validation";
import { Injectable, Optional } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import {
  BadRequestAppError,
  ConflictAppError,
  ForbiddenAppError,
  NotFoundAppError,
  PaymentRequiredAppError,
  ValidationAppError,
} from "../../common/errors/app-error";
import { type Clock, systemClock } from "../../common/clock";
import { availabilityKey } from "../../infra/redis/keys";
import { PostgresService } from "../../infra/postgres/postgres.service";
import { RedisService } from "../../infra/redis/redis.service";
import { CandidateRepository } from "../matching/repositories/candidate.repository";
import { IntentsService } from "../intents/intents.service";
import { type FromState, canTransition } from "./availability-state-machine";
import { AVAILABILITY_CHANGED_EVENT } from "./availability-events";
import {
  AvailabilityRepository,
  UniqueActiveSessionViolation,
} from "./repositories/availability.repository";

export type CreateSessionInput = z.infer<
  ReturnType<typeof availabilityValidation.createSessionSchema>
>;
export type ExtendSessionInput = z.infer<typeof availabilityValidation.extendSessionSchema>;

const FREE_MAX_DURATION_MINUTES = 120; // BR-AVAIL-01: the largest non-Premium preset.
const CUMULATIVE_CAP_MINUTES = 240; // BR-AVAIL-05.
const NEARBY_PREVIEW_RADIUS_M = 10_000; // match_preview's own "nearby" pool — a fixed sensible default, not the user's full search radius.
const MAX_EXTENSIONS = 3;

export interface SessionIntentSummary {
  id: string;
  type: string;
}

export interface SessionResponse {
  id: string;
  state: string;
  started_at: string;
  expires_at: string | null;
  duration_minutes: number | null;
  extensions_used: number;
  extensions_remaining: number;
  note: string | null;
  session_intents: SessionIntentSummary[];
}

export interface MatchPreview {
  available_now_count: number;
  nearby_count: number;
  // Real weighted scoring doesn't exist yet (P12/P13's job) — honestly
  // null rather than a fabricated number, same principle P8.1's
  // match_preview and the onboarding live-counter both apply.
  top_score: number | null;
}

export interface CreateSessionResult {
  session: SessionResponse;
  match_preview: MatchPreview | null;
}

export interface EndSessionSummary {
  matches_viewed: number;
  requests_sent: number;
  conversations_started: number;
  duration_actual_minutes: number;
}

// PRD §10.3, endpoints 18/19/20. "The most important module in the
// product." BR-AVAIL-01…17 enforced here; the belt-and-braces expiry
// sweeper (BR-AVAIL-02/07/08) and recurring schedules (BR-AVAIL-09…11)
// are P10.2/P10.3's own scope, not built by this phase.
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly postgres: PostgresService,
    private readonly availabilityRepository: AvailabilityRepository,
    private readonly candidateRepository: CandidateRepository,
    private readonly intentsService: IntentsService,
    private readonly redis: RedisService,
    @Optional() private readonly clock: Clock = systemClock,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  // §10.3's duration bound depends on the caller's plan (free: {15,30,60,120},
  // Premium: 1-240 — BR-AVAIL-01), which the route-level ZodValidationPipe
  // can't know at decoration time (it's built once, no request context —
  // same constraint documented on profile-children.service.ts's
  // createExperienceValidated). The controller therefore validates
  // shape-only against the loosest (Premium) bound, and this method
  // re-checks the real plan's bound itself — same pattern
  // location.service.ts's updatePreferences uses for search_radius_km.
  async createSession(
    userId: string,
    plan: string,
    input: CreateSessionInput,
  ): Promise<CreateSessionResult> {
    const now = this.clock.now();
    const isPremium = plan !== "free";

    if (input.state === "available_now" && input.duration_minutes !== undefined) {
      // PRD §13 F11 trigger 5: "custom duration > 120 min -> paywall:
      // session length" — checked ahead of the generic shape validation
      // below so this specific case (a free-plan user asking for more
      // than the free ceiling) surfaces as a paywall-worthy 402 naming
      // the limit, not a generic 422 shape error. Every other invalid
      // duration (wrong discrete value, non-multiple-of-15, etc.) still
      // falls through to the existing generic path.
      if (!isPremium && input.duration_minutes > FREE_MAX_DURATION_MINUTES) {
        throw new PaymentRequiredAppError(
          "PREMIUM_REQUIRED",
          "Sessions longer than 2 hours are a Premium feature.",
          {
            details: {
              limit_minutes: FREE_MAX_DURATION_MINUTES,
              requested_minutes: input.duration_minutes,
            },
          },
        );
      }
      const durationCheck = availabilityValidation.createSessionSchema(isPremium).safeParse(input);
      if (!durationCheck.success) {
        throw new ValidationAppError(
          "VALIDATION_FAILED",
          availabilityValidation.DURATION_MINUTES_ERROR,
          {
            field: "duration_minutes",
          },
        );
      }
    }

    const [profile] = await this.postgres.db
      .select({
        profileVisibility: profiles.profileVisibility,
        geohash5: profiles.geohash5,
        cityId: profiles.cityId,
        searchRadiusKm: profiles.searchRadiusKm,
      })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    if (!profile) throw new NotFoundAppError("PROFILE_NOT_FOUND", "This profile isn't available");

    // BR-AVAIL-12: "private profiles cannot be available."
    if (profile.profileVisibility === "private") {
      throw new ForbiddenAppError("PROFILE_PRIVATE", "Make your profile visible to go available.");
    }

    const active = await this.availabilityRepository.getActiveSession(userId);
    const fromState: FromState = (active?.state as FromState | undefined) ?? "offline";
    if (!canTransition(fromState, input.state)) {
      throw new ConflictAppError(
        "INVALID_STATE_TRANSITION",
        `Can't go from ${fromState} directly to ${input.state}.`,
      );
    }

    // BR-AVAIL-04: session-scoped intents are a subset of active intents;
    // omitted means all active intents apply.
    const activeIntents = await this.intentsService.listIntents(userId, false);
    const activeIntentIds = new Set(activeIntents.map((i) => i.id));
    for (const id of input.session_intent_ids ?? []) {
      if (!activeIntentIds.has(id)) {
        throw new BadRequestAppError("BAD_REQUEST", "That intent isn't active on your profile.", {
          field: "session_intent_ids",
        });
      }
    }
    const sessionIntentIds = input.session_intent_ids ?? activeIntents.map((i) => i.id);

    const durationMinutes =
      input.state === "available_now" ? (input.duration_minutes ?? null) : null;
    const expiresAt =
      durationMinutes !== null ? new Date(now.getTime() + durationMinutes * 60_000) : null;

    let created: AvailabilitySession;
    try {
      created = await this.availabilityRepository.createSession({
        userId,
        state: input.state,
        durationMinutes,
        expiresAt,
        note: input.note ?? null,
        source: input.source ?? null,
        intentIds: sessionIntentIds,
        geohash5: profile.geohash5,
        cityId: profile.cityId,
        now,
      });
    } catch (error) {
      if (error instanceof UniqueActiveSessionViolation) {
        throw new ConflictAppError(
          "CONFLICT",
          "Your availability is already being changed — try again.",
        );
      }
      throw error;
    }

    await this.mirrorToRedis(userId, created, sessionIntentIds);
    this.events?.emit(AVAILABILITY_CHANGED_EVENT, {
      userId,
      state: created.state,
      expiresAt: created.expiresAt,
    });

    const matchPreview =
      input.state === "available_now"
        ? await this.computeMatchPreview(userId, profile.searchRadiusKm)
        : null;

    return {
      session: this.toSessionResponse(
        created,
        this.intentSummaries(sessionIntentIds, activeIntents),
      ),
      match_preview: matchPreview,
    };
  }

  // §10.3.3: "AvailableNow -> AvailableNow: extend(+15/30/60 min)" — the
  // only state extension applies to.
  async extendSession(
    userId: string,
    sessionId: string,
    plan: string,
    input: ExtendSessionInput,
  ): Promise<SessionResponse> {
    const now = this.clock.now();
    const isPremium = plan !== "free";

    const session = await this.getOwnedSession(userId, sessionId);
    if (session.endedAt)
      throw new ConflictAppError("SESSION_ALREADY_ENDED", "This session has already ended.");
    if (session.state !== "available_now" || !session.expiresAt) {
      throw new BadRequestAppError("BAD_REQUEST", "Only an Available Now session can be extended.");
    }
    if (session.extensionsUsed >= MAX_EXTENSIONS) {
      throw new ConflictAppError(
        "MAX_EXTENSIONS_REACHED",
        "You've used all 3 extensions for this session.",
      );
    }

    const currentTotalMinutes =
      (session.expiresAt.getTime() - session.startedAt.getTime()) / 60_000;
    const newTotalMinutes = currentTotalMinutes + input.additional_minutes;
    if (newTotalMinutes > CUMULATIVE_CAP_MINUTES) {
      throw new ConflictAppError(
        "MAX_EXTENSIONS_REACHED",
        "Start a new session instead — this one has reached the 240-minute cap.",
      );
    }
    if (!isPremium && newTotalMinutes > FREE_MAX_DURATION_MINUTES) {
      throw new PaymentRequiredAppError(
        "PREMIUM_REQUIRED",
        "Upgrade to extend an Available Now session past 2 hours total.",
      );
    }

    const newExpiresAt = new Date(session.expiresAt.getTime() + input.additional_minutes * 60_000);
    const updated = await this.availabilityRepository.extendSession(
      sessionId,
      userId,
      newExpiresAt,
      now,
    );
    if (!updated)
      throw new NotFoundAppError("SESSION_NOT_FOUND", "This session could not be found.");

    const sessionIntents = await this.sessionIntentSummaries(sessionId);
    await this.mirrorToRedis(
      userId,
      updated,
      sessionIntents.map((i) => i.id),
    );
    this.events?.emit(AVAILABILITY_CHANGED_EVENT, {
      userId,
      state: updated.state,
      expiresAt: updated.expiresAt,
    });

    return this.toSessionResponse(updated, sessionIntents);
  }

  async endSession(userId: string, sessionId: string): Promise<EndSessionSummary> {
    const now = this.clock.now();
    const session = await this.getOwnedSession(userId, sessionId);
    if (session.endedAt)
      throw new ConflictAppError("SESSION_ALREADY_ENDED", "This session has already ended.");

    const ended = await this.availabilityRepository.endSession(sessionId, userId, now, "manual");
    if (!ended) throw new NotFoundAppError("SESSION_NOT_FOUND", "This session could not be found.");

    await this.redis.client.del(availabilityKey(userId));
    this.events?.emit(AVAILABILITY_CHANGED_EVENT, { userId, state: "offline", expiresAt: null });

    return {
      matches_viewed: ended.matchesViewed,
      requests_sent: ended.requestsSent,
      conversations_started: ended.conversationsStarted,
      duration_actual_minutes: Math.round((now.getTime() - ended.startedAt.getTime()) / 60_000),
    };
  }

  async getCurrent(userId: string): Promise<{ current_session: SessionResponse | null }> {
    const active = await this.availabilityRepository.getActiveSession(userId);
    if (!active) return { current_session: null };
    return {
      current_session: this.toSessionResponse(active, await this.sessionIntentSummaries(active.id)),
    };
  }

  async getHistory(
    userId: string,
    from: Date | null,
    to: Date | null,
  ): Promise<{
    sessions: SessionResponse[];
    aggregates: { total_minutes: number; sessions: number; conversations: number };
  }> {
    const sessions = await this.availabilityRepository.getHistory(userId, from, to);
    const responses = await Promise.all(
      sessions.map(async (s) => this.toSessionResponse(s, await this.sessionIntentSummaries(s.id))),
    );

    let totalMinutes = 0;
    let conversations = 0;
    for (const s of sessions) {
      const end = s.endedAt ?? s.expiresAt ?? this.clock.now();
      totalMinutes += Math.max(0, (end.getTime() - s.startedAt.getTime()) / 60_000);
      conversations += s.conversationsStarted;
    }

    return {
      sessions: responses,
      aggregates: {
        total_minutes: Math.round(totalMinutes),
        sessions: sessions.length,
        conversations,
      },
    };
  }

  private async getOwnedSession(userId: string, sessionId: string): Promise<AvailabilitySession> {
    const [session] = await this.postgres.db
      .select()
      .from(availabilitySessions)
      .where(and(eq(availabilitySessions.id, sessionId), eq(availabilitySessions.userId, userId)))
      .limit(1);
    if (!session)
      throw new NotFoundAppError("SESSION_NOT_FOUND", "This session could not be found.");
    return session;
  }

  private async mirrorToRedis(
    userId: string,
    session: AvailabilitySession,
    intentIds: string[],
  ): Promise<void> {
    const ttlSeconds = session.expiresAt
      ? Math.max(1, Math.round((session.expiresAt.getTime() - this.clock.now().getTime()) / 1000))
      : null;
    const payload = JSON.stringify({
      state: session.state,
      expiresAt: session.expiresAt,
      sessionId: session.id,
      intentIds,
    });
    // §21.9: Redis is disposable — a write failure here doesn't fail the
    // request; Postgres (already committed) remains the source of truth
    // and the belt-and-braces sweeper (P10.2) reconciles from it.
    try {
      if (ttlSeconds) {
        await this.redis.client.set(availabilityKey(userId), payload, "EX", ttlSeconds);
      } else {
        await this.redis.client.set(availabilityKey(userId), payload);
      }
    } catch {
      // swallowed intentionally — see comment above.
    }
  }

  private async computeMatchPreview(userId: string, searchRadiusKm: number): Promise<MatchPreview> {
    const ctx = await this.candidateRepository.resolveViewerContext(userId);
    if (!ctx) return { available_now_count: 0, nearby_count: 0, top_score: null };

    const [availableNow, nearby] = await Promise.all([
      this.candidateRepository.stage0(ctx, searchRadiusKm * 1000),
      this.candidateRepository.countWithinRadius(ctx, NEARBY_PREVIEW_RADIUS_M),
    ]);

    return { available_now_count: availableNow.length, nearby_count: nearby, top_score: null };
  }

  private intentSummaries(
    ids: string[],
    pool: { id: string; type: string }[],
  ): SessionIntentSummary[] {
    const byId = new Map(pool.map((i) => [i.id, i.type]));
    return ids.filter((id) => byId.has(id)).map((id) => ({ id, type: byId.get(id)! }));
  }

  private async sessionIntentSummaries(sessionId: string): Promise<SessionIntentSummary[]> {
    return this.postgres.db
      .select({ id: userIntents.id, type: userIntents.type })
      .from(availabilitySessionIntents)
      .innerJoin(userIntents, eq(userIntents.id, availabilitySessionIntents.intentId))
      .where(eq(availabilitySessionIntents.sessionId, sessionId));
  }

  private toSessionResponse(
    session: AvailabilitySession,
    sessionIntents: SessionIntentSummary[],
  ): SessionResponse {
    return {
      id: session.id,
      state: session.state,
      started_at: session.startedAt.toISOString(),
      expires_at: session.expiresAt ? session.expiresAt.toISOString() : null,
      duration_minutes: session.durationMinutes,
      extensions_used: session.extensionsUsed,
      extensions_remaining: Math.max(0, MAX_EXTENSIONS - session.extensionsUsed),
      note: session.note,
      session_intents: sessionIntents,
    };
  }
}
