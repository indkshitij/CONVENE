import { Injectable, Optional } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { type Clock, systemClock } from "../../common/clock";
import { availabilityKey, presenceKey } from "../../infra/redis/keys";
import { RedisService } from "../../infra/redis/redis.service";
import { AVAILABILITY_CHANGED_EVENT } from "./availability-events";
import { AvailabilityRepository } from "./repositories/availability.repository";

export const AVAILABILITY_EXPIRING_SOON_EVENT = "availability.expiring_soon";
export const AVAILABILITY_EXPIRED_EVENT = "availability.expired";

const WARNING_WINDOW_MS = 5 * 60 * 1000; // BR-AVAIL-06: T-5min.
const WARNING_DEDUPE_TTL_SECONDS = 10 * 60; // outlives the warning window so it never re-fires for the same session.
const AUTO_AWAY_INACTIVITY_MS = 10 * 60 * 1000; // BR-AVAIL-07.
const DISCONNECT_GRACE_MS = 5 * 60 * 1000; // BR-AVAIL-08.

interface PresencePayload {
  active: boolean;
  lastBeat: string;
}

// PRD §10.3.10. The single, idempotent core both belt-and-braces
// mechanisms (the sweeper worker and the Redis keyspace listener) call —
// neither mechanism contains its own copy of "how to end a session,"
// which is exactly what makes "either alone must be sufficient" and
// "double expiry produces exactly one event" true by construction rather
// than by coincidence.
@Injectable()
export class AvailabilityExpiryService {
  constructor(
    private readonly repository: AvailabilityRepository,
    private readonly redis: RedisService,
    @Optional() private readonly clock: Clock = systemClock,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  // Idempotent: repository.expireSessionById only returns a row on the
  // call that actually flips ended_at (WHERE ended_at IS NULL). Whichever
  // of the sweeper/listener loses the race gets `null` back and emits
  // nothing — this is *why* double-processing is harmless, not merely
  // asserted to be.
  async expireSession(sessionId: string): Promise<void> {
    const now = this.clock.now();
    const ended = await this.repository.expireSessionById(sessionId, now);
    if (!ended) return;

    await this.redis.client.del(availabilityKey(ended.userId));
    this.events?.emit(AVAILABILITY_EXPIRED_EVENT, {
      userId: ended.userId,
      sessionId: ended.id,
      summary: {
        matchesViewed: ended.matchesViewed,
        requestsSent: ended.requestsSent,
        conversationsStarted: ended.conversationsStarted,
      },
    });
    this.events?.emit(AVAILABILITY_CHANGED_EVENT, {
      userId: ended.userId,
      state: "offline",
      expiresAt: null,
    });
  }

  // §10.3.10 "belt": the keyspace-notification listener only knows which
  // *userId*'s avail:{userId} key expired, not the sessionId — this
  // resolves that and delegates to the same idempotent core.
  async expireByUserId(userId: string): Promise<void> {
    const active = await this.repository.getActiveSession(userId);
    if (!active) return;
    await this.expireSession(active.id);
  }

  // §10.3.10 "braces": the sweeper's own sweep of every session whose
  // expires_at has already passed.
  async sweepExpired(): Promise<number> {
    const now = this.clock.now();
    const due = await this.repository.findExpiredSessions(now);
    for (const session of due) {
      await this.expireSession(session.id);
    }
    return due.length;
  }

  // BR-AVAIL-06: T-5min warning, fired once per session (a Redis flag
  // dedupes across the sweeper's own 30s cadence for the ~10 ticks a
  // session spends inside the 5-minute window).
  async warnExpiringSoon(): Promise<number> {
    const now = this.clock.now();
    const soon = await this.repository.findSessionsExpiringWithin(now, WARNING_WINDOW_MS);
    let warned = 0;
    for (const session of soon) {
      const dedupeKey = `${availabilityKey(session.userId)}:warned:${session.id}`;
      const alreadyWarned = await this.redis.client.get(dedupeKey);
      if (alreadyWarned) continue;

      await this.redis.client.set(dedupeKey, "1", "EX", WARNING_DEDUPE_TTL_SECONDS);
      const minutesRemaining = session.expiresAt
        ? Math.max(0, Math.round((session.expiresAt.getTime() - now.getTime()) / 60_000))
        : 0;
      this.events?.emit(AVAILABILITY_EXPIRING_SOON_EVENT, {
        userId: session.userId,
        sessionId: session.id,
        minutesRemaining,
      });
      warned += 1;
    }
    return warned;
  }

  // BR-AVAIL-07/BR-AVAIL-08. Both read presence:{userId} (owned/written by
  // the realtime gateway, P11.1 — not built yet), so this is exercised
  // today only via a directly-populated fake Redis client in tests; the
  // logic itself doesn't depend on how that key gets written, only on its
  // documented shape (§10.3.9/§10.3.10).
  async checkPresenceDrivenTransitions(): Promise<{ awaySet: number; disconnected: number }> {
    const now = this.clock.now();
    const activeSessions = await this.repository.findActiveAvailableNowSessions();

    let awaySet = 0;
    let disconnected = 0;
    for (const session of activeSessions) {
      const raw = await this.redis.client.get(presenceKey(session.userId));
      if (!raw) {
        // No presence key at all: either never connected, or its TTL
        // lapsed (BR-AVAIL-14: 45s TTL, three missed 20s heartbeats).
        // Treated as disconnected once the grace period elapses from the
        // session's own last update — a coarse proxy in the absence of a
        // tracked "disconnectedAt" timestamp, flagged as a simplification.
        const elapsedSinceStart = now.getTime() - session.startedAt.getTime();
        if (elapsedSinceStart > DISCONNECT_GRACE_MS) {
          await this.endSessionDisconnected(session.id);
          disconnected += 1;
        }
        continue;
      }

      const presence = this.parsePresence(raw);
      if (!presence) continue;

      const lastBeatMs = new Date(presence.lastBeat).getTime();
      const inactiveMs = now.getTime() - lastBeatMs;

      if (!presence.active && inactiveMs > AUTO_AWAY_INACTIVITY_MS) {
        await this.repository.setSessionState(session.id, "away", now);
        this.events?.emit(AVAILABILITY_CHANGED_EVENT, {
          userId: session.userId,
          state: "away",
          expiresAt: session.expiresAt,
        });
        awaySet += 1;
      }
    }
    return { awaySet, disconnected };
  }

  // BR-AVAIL-07's recovery half: "Returning to activity restores
  // Available Now if the window has not expired." Called by whatever
  // detects renewed activity (the future P11.1 heartbeat handler) —
  // exposed here so that caller has a single, tested place to call into.
  // setSessionState's own `WHERE ended_at IS NULL` guard is what makes
  // "if the window has not expired" hold: an already-expired session
  // simply won't update.
  async recoverFromAway(sessionId: string): Promise<void> {
    const now = this.clock.now();
    const recovered = await this.repository.setSessionState(sessionId, "available_now", now);
    if (recovered) {
      this.events?.emit(AVAILABILITY_CHANGED_EVENT, {
        userId: recovered.userId,
        state: "available_now",
        expiresAt: recovered.expiresAt,
      });
    }
  }

  private async endSessionDisconnected(sessionId: string): Promise<void> {
    const now = this.clock.now();
    const ended = await this.repository.expireSessionById(sessionId, now, "disconnected");
    if (!ended) return;
    await this.redis.client.del(availabilityKey(ended.userId));
    this.events?.emit(AVAILABILITY_CHANGED_EVENT, {
      userId: ended.userId,
      state: "offline",
      expiresAt: null,
    });
  }

  private parsePresence(raw: string): PresencePayload | null {
    try {
      const parsed = JSON.parse(raw) as Partial<PresencePayload>;
      if (typeof parsed.active !== "boolean" || typeof parsed.lastBeat !== "string") return null;
      return { active: parsed.active, lastBeat: parsed.lastBeat };
    } catch {
      return null;
    }
  }
}
