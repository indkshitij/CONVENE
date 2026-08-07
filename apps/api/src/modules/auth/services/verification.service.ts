import { createHash, randomBytes, randomInt } from "node:crypto";
import { verificationTokens } from "@convene/db";
import { Injectable, Optional } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { PostgresService } from "../../../infra/postgres/postgres.service";
import { type Clock, systemClock } from "../../../common/clock";

// PRD §10.1.4/§10.1.7: "Email verification by signed single-use token."
// No exact TTL is given anywhere in §10.1/§17.4 for this token (only OTP
// has a stated TTL) — 24h is a defensible default, flagged as an
// assumption rather than a transcription.
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

// PRD §10.1.7 endpoint 8 (password/reset). No exact TTL is given for this
// token either — 1h is a shorter, more conventional window for a
// credential-reset link than the 24h identity-verification link above,
// flagged as an assumption rather than a transcription.
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

// PRD §10.2.5 L3 (work email). Same 10-minute window as OTP codes
// (otp.service.ts) since this is conceptually a short-lived code sent to
// an address the caller must actively check, not a long-lived link.
const WORK_EMAIL_VERIFICATION_TTL_MS = 10 * 60 * 1000;

export interface CreateVerificationTokenResult {
  /** Raw, single-use token — embedded in the verification link, never stored. */
  token: string;
  expiresAt: Date;
}

export type ConsumeVerificationTokenResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "TOKEN_INVALID" | "TOKEN_USED" | "TOKEN_EXPIRED" };

export interface CreateWorkEmailCodeResult {
  /** 6-digit code, delivered to `target` — never stored in the clear. */
  code: string;
  expiresAt: Date;
}

export type ConsumeWorkEmailTokenResult =
  | { ok: true; userId: string; target: string }
  | { ok: false; reason: "TOKEN_INVALID" | "TOKEN_USED" | "TOKEN_EXPIRED" };

// PRD §10.1.7: `POST /auth/email/verify → 200 | 410 TOKEN_EXPIRED`. The
// raw token is a 256-bit random value; only its SHA-256 hash is ever
// persisted (the same "never recoverable" pattern as refresh tokens,
// §17.4/§20.4), and it's single-use via the usedAt column.
@Injectable()
export class VerificationService {
  constructor(
    private readonly postgres: PostgresService,
    // See otp.service.ts's constructor comment: Clock is an interface, so
    // @Optional() is required for Nest DI to fall through to the default.
    @Optional() private readonly clock: Clock = systemClock,
  ) {}

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  async createEmailVerificationToken(userId: string): Promise<CreateVerificationTokenResult> {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = this.hashToken(token);
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS);

    await this.postgres.db.insert(verificationTokens).values({
      userId,
      type: "email_verify",
      tokenHash,
      expiresAt,
    });

    return { token, expiresAt };
  }

  async consumeEmailVerificationToken(token: string): Promise<ConsumeVerificationTokenResult> {
    const tokenHash = this.hashToken(token);
    const now = this.clock.now();

    const [record] = await this.postgres.db
      .select()
      .from(verificationTokens)
      .where(
        and(
          eq(verificationTokens.tokenHash, tokenHash),
          eq(verificationTokens.type, "email_verify"),
        ),
      )
      .limit(1);

    if (!record) return { ok: false, reason: "TOKEN_INVALID" };
    if (record.usedAt) return { ok: false, reason: "TOKEN_USED" };
    if (record.expiresAt.getTime() < now.getTime()) return { ok: false, reason: "TOKEN_EXPIRED" };

    await this.postgres.db
      .update(verificationTokens)
      .set({ usedAt: now })
      .where(eq(verificationTokens.id, record.id));

    return { ok: true, userId: record.userId };
  }

  async createPasswordResetToken(userId: string): Promise<CreateVerificationTokenResult> {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = this.hashToken(token);
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);

    await this.postgres.db.insert(verificationTokens).values({
      userId,
      type: "password_reset",
      tokenHash,
      expiresAt,
    });

    return { token, expiresAt };
  }

  async consumePasswordResetToken(token: string): Promise<ConsumeVerificationTokenResult> {
    const tokenHash = this.hashToken(token);
    const now = this.clock.now();

    const [record] = await this.postgres.db
      .select()
      .from(verificationTokens)
      .where(
        and(
          eq(verificationTokens.tokenHash, tokenHash),
          eq(verificationTokens.type, "password_reset"),
        ),
      )
      .limit(1);

    if (!record) return { ok: false, reason: "TOKEN_INVALID" };
    if (record.usedAt) return { ok: false, reason: "TOKEN_USED" };
    if (record.expiresAt.getTime() < now.getTime()) return { ok: false, reason: "TOKEN_EXPIRED" };

    await this.postgres.db
      .update(verificationTokens)
      .set({ usedAt: now })
      .where(eq(verificationTokens.id, record.id));

    return { ok: true, userId: record.userId };
  }

  // PRD §10.2.5 L3 / §10.2.9 (POST /verification/work-email,
  // /verification/work-email/confirm). `target` is the corporate address
  // the code was sent to — distinct from users.email, hence the nullable
  // `target` column added by migrations/0009_verification_ladder.sql
  // rather than reusing the userId's own email.
  // A 6-digit code rather than a link token: the inbox this is sent to
  // (an arbitrary corporate address supplied by the caller) may not be the
  // same session that's browsing Convene, so confirmation happens by the
  // user typing the code back in rather than clicking a link.
  async createWorkEmailVerificationToken(
    userId: string,
    target: string,
  ): Promise<CreateWorkEmailCodeResult> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const tokenHash = this.hashToken(code);
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + WORK_EMAIL_VERIFICATION_TTL_MS);

    await this.postgres.db.insert(verificationTokens).values({
      userId,
      type: "work_email",
      target,
      tokenHash,
      expiresAt,
    });

    return { code, expiresAt };
  }

  async consumeWorkEmailVerificationToken(
    userId: string,
    code: string,
  ): Promise<ConsumeWorkEmailTokenResult> {
    const tokenHash = this.hashToken(code);
    const now = this.clock.now();

    const [record] = await this.postgres.db
      .select()
      .from(verificationTokens)
      .where(
        and(
          eq(verificationTokens.userId, userId),
          eq(verificationTokens.type, "work_email"),
          eq(verificationTokens.tokenHash, tokenHash),
        ),
      )
      .limit(1);

    if (!record) return { ok: false, reason: "TOKEN_INVALID" };
    if (record.usedAt) return { ok: false, reason: "TOKEN_USED" };
    if (record.expiresAt.getTime() < now.getTime()) return { ok: false, reason: "TOKEN_EXPIRED" };

    await this.postgres.db
      .update(verificationTokens)
      .set({ usedAt: now })
      .where(eq(verificationTokens.id, record.id));

    // target is NOT NULL for every work_email row this service itself
    // creates (createWorkEmailVerificationToken always sets it) — the
    // column is only nullable to stay backward-compatible with the
    // pre-existing email_verify/password_reset rows.
    return { ok: true, userId: record.userId, target: record.target as string };
  }
}
