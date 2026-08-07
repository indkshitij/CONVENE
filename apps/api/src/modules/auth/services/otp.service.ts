import { randomInt } from "node:crypto";
import { otpChallenges } from "@convene/db";
import { Injectable, Optional } from "@nestjs/common";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import * as argon2 from "argon2";
import { PostgresService } from "../../../infra/postgres/postgres.service";
import { type Clock, systemClock } from "../../../common/clock";
import { ARGON2_OPTIONS } from "./password.service";

export type OtpChannel = "email" | "phone";

// PRD §17.4 / §20.2: "OTP 6 digits, hashed, 10-minute TTL, 5 attempts,
// single-use." §10.1.2's BR-AUTH-08 states a 5-minute TTL instead — a
// documented PRD-internal inconsistency (2 of 3 references, and the P5.2
// prompt's own explicit instruction, say 10 min; this follows that).
const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_VERIFICATION_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_RESENDS_PER_HOUR = 3;
const CODE_LENGTH = 6;
const ONE_HOUR_MS = 60 * 60 * 1000;

export interface SendOtpResult {
  code: string;
  expiresAt: Date;
  resendAvailableInSeconds: number;
}

export interface SendOtpRejection {
  reason: "OTP_RATE_LIMITED";
  retryAfterSeconds: number;
}

export type VerifyOtpResult =
  { ok: true } | { ok: false; reason: "OTP_INVALID" | "OTP_EXPIRED" | "OTP_MAX_ATTEMPTS" };

// PRD BR-AUTH-08, translated faithfully: 6-digit codes, Argon2id-hashed at
// rest (never stored in the clear), a 60s cooldown and 3/hour cap on
// resends, and a 5-attempt cap on verification. Append-only rows (one per
// send) so cooldown/rate-limit windows are derived from history rather
// than a separate mutable counter.
@Injectable()
export class OtpService {
  constructor(
    private readonly postgres: PostgresService,
    // Clock is an interface (erased at runtime), so plain Nest DI can't
    // resolve it by type — @Optional() makes Nest inject `undefined`
    // instead of throwing, which is exactly what lets this parameter's
    // own default value (systemClock) apply.
    @Optional() private readonly clock: Clock = systemClock,
  ) {}

  private generateCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(CODE_LENGTH, "0");
  }

  async send(
    userId: string,
    channel: OtpChannel,
  ): Promise<{ ok: true; result: SendOtpResult } | { ok: false; rejection: SendOtpRejection }> {
    const now = this.clock.now();
    const windowStart = new Date(now.getTime() - ONE_HOUR_MS);

    const recentChallenges = await this.postgres.db
      .select()
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.userId, userId),
          eq(otpChallenges.channel, channel),
          gt(otpChallenges.createdAt, windowStart),
        ),
      )
      .orderBy(desc(otpChallenges.createdAt));

    const mostRecent = recentChallenges[0];
    if (mostRecent) {
      const cooldownEndsAt = new Date(mostRecent.createdAt.getTime() + RESEND_COOLDOWN_MS);
      if (now.getTime() < cooldownEndsAt.getTime()) {
        return {
          ok: false,
          rejection: {
            reason: "OTP_RATE_LIMITED",
            retryAfterSeconds: Math.ceil((cooldownEndsAt.getTime() - now.getTime()) / 1000),
          },
        };
      }
    }

    if (recentChallenges.length >= MAX_RESENDS_PER_HOUR) {
      const oldestInWindow = recentChallenges[
        recentChallenges.length - 1
      ] as (typeof recentChallenges)[number];
      const windowResetsAt = new Date(oldestInWindow.createdAt.getTime() + ONE_HOUR_MS);
      return {
        ok: false,
        rejection: {
          reason: "OTP_RATE_LIMITED",
          retryAfterSeconds: Math.ceil((windowResetsAt.getTime() - now.getTime()) / 1000),
        },
      };
    }

    const code = this.generateCode();
    const codeHash = await argon2.hash(code, ARGON2_OPTIONS);
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS);

    await this.postgres.db.insert(otpChallenges).values({ userId, channel, codeHash, expiresAt });

    return {
      ok: true,
      result: { code, expiresAt, resendAvailableInSeconds: RESEND_COOLDOWN_MS / 1000 },
    };
  }

  async verify(userId: string, channel: OtpChannel, code: string): Promise<VerifyOtpResult> {
    const now = this.clock.now();

    const [active] = await this.postgres.db
      .select()
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.userId, userId),
          eq(otpChallenges.channel, channel),
          isNull(otpChallenges.consumedAt),
        ),
      )
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1);

    if (!active) return { ok: false, reason: "OTP_INVALID" };
    if (active.attempts >= MAX_VERIFICATION_ATTEMPTS)
      return { ok: false, reason: "OTP_MAX_ATTEMPTS" };
    if (active.expiresAt.getTime() < now.getTime()) return { ok: false, reason: "OTP_EXPIRED" };

    const matches = await argon2.verify(active.codeHash, code);
    if (!matches) {
      const attemptsNow = active.attempts + 1;
      await this.postgres.db
        .update(otpChallenges)
        .set({ attempts: attemptsNow })
        .where(eq(otpChallenges.id, active.id));
      return {
        ok: false,
        reason: attemptsNow >= MAX_VERIFICATION_ATTEMPTS ? "OTP_MAX_ATTEMPTS" : "OTP_INVALID",
      };
    }

    await this.postgres.db
      .update(otpChallenges)
      .set({ consumedAt: now })
      .where(eq(otpChallenges.id, active.id));
    return { ok: true };
  }
}
