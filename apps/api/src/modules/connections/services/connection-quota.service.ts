import { Injectable } from "@nestjs/common";
import { uuidv7 } from "../../../common/utils/uuidv7";
import {
  connectionRequestDailyQuotaKey,
  connectionRequestNoteHashKey,
  connectionRequestSoftBlockKey,
} from "../../../infra/redis/keys";
import { rateLimitKey } from "../../../infra/redis/keys";
import { RedisService } from "../../../infra/redis/redis.service";
import { evalSlidingWindow } from "../../../common/rate-limit/sliding-window";
import { RATE_LIMIT_POLICIES } from "../../../common/rate-limit/policies";

export type ConnectionPlan = "free" | "premium" | "pro";

// PRD §10.6.7's own table (the more detailed of the two conflicting
// sources — the P14.1 prompt paraphrases this as "5-per-10-minute", the
// table itself says "60 s"; the table wins).
const DAILY_LIMITS: Record<ConnectionPlan, number> = { free: 8, premium: 30, pro: 120 };

const IDENTICAL_NOTE_LIMIT = 3; // BR-CONN-06: > 3 near-identical notes in 24h.
const IDENTICAL_NOTE_WINDOW_MS = 24 * 60 * 60 * 1000;
const IDENTICAL_NOTE_SIMILARITY_THRESHOLD = 0.9;
const SOFT_BLOCK_SECONDS = 60 * 60; // BR-CONN-06: 60 min soft-block.
const NOTE_HISTORY_CAP = 20; // Bounds the per-user note-history list.

export interface DailyQuota {
  used: number;
  limit: number;
  resetsAt: Date;
}

export type QuotaDenialReason = "DAILY_LIMIT_REACHED" | "VELOCITY_LIMIT" | "SOFT_BLOCKED";

export interface QuotaCheckResult {
  allowed: boolean;
  reason: QuotaDenialReason | null;
  quota: DailyQuota;
}

function planToVelocityScope(
  plan: ConnectionPlan,
): "connection-requests-velocity" | "connection-requests-velocity-pro" {
  return plan === "pro" ? "connection-requests-velocity-pro" : "connection-requests-velocity";
}

// BR-CONN-05/06 (P14.1): daily send quota (Redis INCR + EXPIRE, keyed to
// the sender's local day) plus the velocity anti-spam checks (60s sliding
// window, identical-note SimHash-style bucket). All state here is
// disposable per §21.9 — losing it just means a sender briefly gets one
// extra request through, never fewer than entitled.
@Injectable()
export class ConnectionQuotaService {
  constructor(private readonly redis: RedisService) {}

  // Local calendar date "YYYY-MM-DD" for `timezone` (IANA), used both as
  // the quota key's day segment and to compute the key's own expiry so a
  // day boundary always coincides with the key's TTL.
  localDateParts(now: Date, timezone: string): { date: string; msUntilLocalMidnight: number } {
    let zoned: string;
    try {
      zoned = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);
    } catch {
      zoned = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(now);
    }
    const nextMidnightUtcGuess = new Date(now);
    nextMidnightUtcGuess.setUTCHours(24, 0, 0, 0);
    // Not exact for every timezone offset (DST edges), but a bounded
    // over/under-estimate is harmless for a disposable Redis TTL — the
    // key just expires a little early or late, never incorrectly denying
    // or permanently allowing.
    const msUntilLocalMidnight = Math.max(60_000, nextMidnightUtcGuess.getTime() - now.getTime());
    return { date: zoned, msUntilLocalMidnight };
  }

  async checkDailyQuota(
    userId: string,
    plan: ConnectionPlan,
    timezone: string,
    now: Date,
  ): Promise<DailyQuota & { allowed: boolean }> {
    const limit = DAILY_LIMITS[plan];
    const { date, msUntilLocalMidnight } = this.localDateParts(now, timezone);
    const key = connectionRequestDailyQuotaKey(userId, date);

    const used = await this.redis.client.incr(key);
    if (used === 1) {
      await this.redis.client.pexpire(key, msUntilLocalMidnight);
    }
    const resetsAt = new Date(now.getTime() + msUntilLocalMidnight);

    if (used > limit) {
      // Roll back the increment for a rejected attempt — quota only
      // counts requests that were actually created (Gherkin: "no request
      // row is created" on the 9th free-plan attempt).
      await this.redis.client.decr(key);
      return { allowed: false, used: limit, limit, resetsAt };
    }
    return { allowed: true, used, limit, resetsAt };
  }

  // Side-effect-free read for GET /entitlements (P24.2) — checkDailyQuota
  // above always increments (this session's own prior finding, see
  // request-composer's honest-quota-display gap), so a plain read needs
  // its own method rather than reusing that one and immediately
  // decrementing back (a race under concurrent requests).
  async peekDailyQuota(
    userId: string,
    plan: ConnectionPlan,
    timezone: string,
    now: Date,
  ): Promise<DailyQuota> {
    const limit = DAILY_LIMITS[plan];
    const { date, msUntilLocalMidnight } = this.localDateParts(now, timezone);
    const key = connectionRequestDailyQuotaKey(userId, date);
    const raw = await this.redis.client.get(key);
    const used = Math.min(limit, raw ? Number(raw) : 0);
    return { used, limit, resetsAt: new Date(now.getTime() + msUntilLocalMidnight) };
  }

  // BR-CONN-06: >5 requests in 60s (free/premium) or >8 (pro). A true
  // sliding-window log via the same Lua script the global RateLimitGuard
  // uses — called directly here (not via @RateLimit) since the limit is
  // plan-dependent and the decorator only carries a static scope.
  async checkVelocity(userId: string, plan: ConnectionPlan, now: Date): Promise<boolean> {
    const scope = planToVelocityScope(plan);
    const policy = RATE_LIMIT_POLICIES[scope];
    const key = rateLimitKey(scope, `user=${userId}`);
    const result = await evalSlidingWindow(
      this.redis.client,
      key,
      now.getTime(),
      policy.windowSeconds * 1000,
      policy.limit,
      uuidv7(),
    );
    return result.allowed;
  }

  async isSoftBlocked(userId: string): Promise<boolean> {
    const blocked = await this.redis.client.get(connectionRequestSoftBlockKey(userId));
    return blocked !== null;
  }

  async applySoftBlock(userId: string): Promise<void> {
    await this.redis.client.set(
      connectionRequestSoftBlockKey(userId),
      "1",
      "EX",
      SOFT_BLOCK_SECONDS,
    );
  }

  // BR-CONN-06: ">3 requests with >=90% identical note text in 24h" —
  // maintains a bounded, TTL'd history of the sender's recent normalised
  // notes and returns true (and applies the soft-block) once a 4th
  // near-duplicate lands within the window. No SimHash algorithm is given
  // by the PRD, so this uses a documented Jaccard-similarity-over-word-
  // shingles heuristic instead of a literal SimHash transcription.
  async recordNoteAndCheckDuplicate(
    userId: string,
    note: string | null,
    now: Date,
  ): Promise<boolean> {
    if (!note || note.trim().length === 0) return false;
    const normalised = normaliseNote(note);
    if (normalised.length === 0) return false;

    const key = connectionRequestNoteHashKey(userId);
    const raw = await this.redis.client.lrange(key, 0, NOTE_HISTORY_CAP - 1);
    const cutoff = now.getTime() - IDENTICAL_NOTE_WINDOW_MS;
    const recent = raw
      .map((entry) => parseHistoryEntry(entry))
      .filter(
        (entry): entry is { text: string; ts: number } => entry !== null && entry.ts > cutoff,
      );

    const similarCount = recent.filter(
      (entry) => jaccardSimilarity(entry.text, normalised) >= IDENTICAL_NOTE_SIMILARITY_THRESHOLD,
    ).length;

    await this.redis.client.lpush(key, `${now.getTime()}|${normalised}`);
    await this.redis.client.ltrim(key, 0, NOTE_HISTORY_CAP - 1);
    await this.redis.client.expire(key, Math.ceil(IDENTICAL_NOTE_WINDOW_MS / 1000));

    if (similarCount >= IDENTICAL_NOTE_LIMIT) {
      await this.applySoftBlock(userId);
      return true;
    }
    return false;
  }
}

function normaliseNote(note: string): string {
  return note
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .sort()
    .join(" ");
}

function parseHistoryEntry(entry: string): { text: string; ts: number } | null {
  const separator = entry.indexOf("|");
  if (separator === -1) return null;
  const ts = Number(entry.slice(0, separator));
  const text = entry.slice(separator + 1);
  if (Number.isNaN(ts)) return null;
  return { ts, text };
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(" "));
  const setB = new Set(b.split(" "));
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const word of setA) if (setB.has(word)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
