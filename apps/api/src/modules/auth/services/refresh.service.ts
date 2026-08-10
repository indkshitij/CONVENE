import { refreshTokens, users, type Database, type RefreshToken } from "@convene/db";
import { Injectable, Optional } from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { AuditLogRepository } from "../../../common/audit/audit-log.repository";
import { NotFoundAppError, UnauthorizedAppError } from "../../../common/errors/app-error";
import { type Clock, systemClock } from "../../../common/clock";
import { AuthContextService } from "../../../common/auth/auth-context";
import { uuidv7 } from "../../../common/utils/uuidv7";
import { PostgresService } from "../../../infra/postgres/postgres.service";
import { EmailService } from "../../notifications/email.service";
import { ACCESS_TOKEN_TTL_SECONDS, TokenService } from "./token.service";

// The transaction-scoped handle drizzle passes into a `db.transaction()`
// callback — structurally compatible with `Database` for the select/
// update/insert calls this service makes, but not the exact same type, so
// it needs its own alias rather than reusing `Database` for `tx` params.
type TransactionHandle = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DbOrTx = Database | TransactionHandle;

// PRD §17.4: "30 days rolling" — every rotation resets the window from now.
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// §10.1.11 edge case #7: "Two devices refresh concurrently with the same
// RT. First wins; second receives TOKEN_REUSE_DETECTED. Mitigated by a 10s
// grace window keyed on the same device fingerprint" — a same-device retry
// (e.g. the client never saw the first response and retries) chains onto
// whatever the family actually advanced to instead of being treated as a
// compromise; a different device within the same window is genuine reuse.
const REPLAY_GRACE_WINDOW_MS = 10 * 1000;

export interface TokensResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  token_type: "Bearer";
}

export interface SessionSummary {
  id: string;
  device: string | null;
  ip_country: string | null;
  last_active_at: string;
  current: boolean;
}

type RotateOutcome = { outcome: "rotated"; tokens: TokensResponse };
type ReuseOutcome = { outcome: "reuse_detected"; userId: string };
type InvalidOutcome = { outcome: "invalid" };
type RefreshOutcome = RotateOutcome | ReuseOutcome | InvalidOutcome;

// PRD §17.4: "The single most important auth control in the system."
// Every refresh issues a new opaque token in the same family and stamps
// the parent's used_at; presenting an already-used token revokes the
// entire family, bumps users.token_version (invalidating every
// outstanding access token via the tv claim), and sends a security email.
@Injectable()
export class RefreshService {
  constructor(
    private readonly postgres: PostgresService,
    private readonly tokenService: TokenService,
    private readonly emailService: EmailService,
    private readonly authContextService: AuthContextService,
    // See otp.service.ts's constructor comment: Clock is an interface, so
    // @Optional() is required for Nest DI to fall through to the default.
    @Optional() private readonly clock: Clock = systemClock,
    @Optional() private readonly auditLog?: AuditLogRepository,
  ) {}

  // PRD §10.1.7 endpoint 3. The whole read-decide-write sequence runs
  // inside one transaction with `SELECT ... FOR UPDATE` on the token row,
  // so two concurrent refreshes of the same token serialise on that lock
  // instead of racing — the second one always observes the first one's
  // committed `used_at`.
  async refresh(rawToken: string, deviceFingerprint: string): Promise<TokensResponse> {
    const tokenHash = this.tokenService.hashRefreshToken(rawToken);
    const now = this.clock.now();

    const outcome = await this.postgres.db.transaction<RefreshOutcome>(async (tx) => {
      const [row] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .for("update");

      if (!row || row.revokedAt || row.expiresAt.getTime() < now.getTime()) {
        return { outcome: "invalid" };
      }

      if (row.usedAt) {
        const [child] = await tx
          .select()
          .from(refreshTokens)
          .where(eq(refreshTokens.parentId, row.id))
          .limit(1);

        const withinGrace = row.usedAt.getTime() + REPLAY_GRACE_WINDOW_MS > now.getTime();
        if (
          child &&
          withinGrace &&
          child.deviceFingerprint === deviceFingerprint &&
          !child.revokedAt
        ) {
          const tokens = await this.rotateRow(tx, child, deviceFingerprint, now);
          return { outcome: "rotated", tokens };
        }

        await this.revokeFamily(tx, row.familyId);
        await tx
          .update(users)
          .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
          .where(eq(users.id, row.userId));
        return { outcome: "reuse_detected", userId: row.userId };
      }

      const tokens = await this.rotateRow(tx, row, deviceFingerprint, now);
      return { outcome: "rotated", tokens };
    });

    if (outcome.outcome === "invalid") {
      throw new UnauthorizedAppError("INVALID_REFRESH_TOKEN", "This session is no longer valid.");
    }
    if (outcome.outcome === "reuse_detected") {
      // Close the up-to-60s auth-context cache window immediately rather
      // than waiting on its TTL — otherwise a stale access token issued
      // before this reuse event would keep passing JwtAuthGuard's tv
      // comparison against a cached (pre-bump) tokenVersion.
      await this.authContextService.invalidate(outcome.userId);
      const [user] = await this.postgres.db
        .select()
        .from(users)
        .where(eq(users.id, outcome.userId))
        .limit(1);
      if (user?.email) {
        await this.emailService.sendSecurityAlertEmail(
          user.email,
          "a previously used sign-in session was presented again",
        );
      }
      // §20.8: "every authentication event" — token-reuse detection is
      // the single highest-severity auth event this codebase has (it
      // revokes an entire session family and bumps token_version), so
      // it's the first auth call site wired to the audit log.
      await this.auditLog?.record({
        actorId: outcome.userId,
        actorType: "system",
        action: "auth.token_reuse_detected",
        entityType: "user",
        entityId: outcome.userId,
        reason:
          "A previously used refresh token was presented again; the session family was revoked.",
      });
      throw new UnauthorizedAppError(
        "TOKEN_REUSE_DETECTED",
        "This session has been revoked for your security. Please sign in again.",
      );
    }
    return outcome.tokens;
  }

  // PRD §10.1.7 endpoint 4. Revokes only the family the presented refresh
  // token belongs to (the caller's own current session).
  async logout(rawToken: string): Promise<void> {
    const tokenHash = this.tokenService.hashRefreshToken(rawToken);
    const [row] = await this.postgres.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);
    if (!row) return;
    await this.revokeFamily(this.postgres.db, row.familyId);
  }

  // PRD §10.1.7 endpoint 5. Every session for the user, not just the
  // caller's own family.
  async logoutAll(userId: string): Promise<void> {
    await this.postgres.db
      .update(refreshTokens)
      .set({ revokedAt: this.clock.now() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  // PRD §10.1.7 endpoint 9 (GET). One row per active family — the most
  // recently created row in that family stands in for the "session" (its
  // device_label/ip_country describe the latest device to use it; its
  // created_at is the family's last-active timestamp).
  async listSessions(userId: string, currentFamilyId: string | null): Promise<SessionSummary[]> {
    const rows = await this.postgres.db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
      .orderBy(desc(refreshTokens.createdAt));

    const latestByFamily = new Map<string, RefreshToken>();
    for (const row of rows) {
      if (!latestByFamily.has(row.familyId)) latestByFamily.set(row.familyId, row);
    }

    return Array.from(latestByFamily.values()).map((row) => ({
      id: row.familyId,
      device: row.deviceLabel,
      ip_country: row.ipCountry,
      last_active_at: row.createdAt.toISOString(),
      current: row.familyId === currentFamilyId,
    }));
  }

  // PRD §10.1.7 endpoint 9 (DELETE). `sessionId` is the family id returned
  // by listSessions — ownership is checked so a user can't revoke another
  // user's session by guessing an id.
  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const [row] = await this.postgres.db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.familyId, sessionId), eq(refreshTokens.userId, userId)))
      .limit(1);
    if (!row) {
      throw new NotFoundAppError("SESSION_NOT_FOUND", "This session could not be found.");
    }
    await this.revokeFamily(this.postgres.db, sessionId);
  }

  private async rotateRow(
    tx: DbOrTx,
    parent: RefreshToken,
    deviceFingerprint: string,
    now: Date,
  ): Promise<TokensResponse> {
    await tx.update(refreshTokens).set({ usedAt: now }).where(eq(refreshTokens.id, parent.id));

    const [user] = await tx.select().from(users).where(eq(users.id, parent.userId)).limit(1);
    if (!user)
      throw new UnauthorizedAppError("INVALID_REFRESH_TOKEN", "This session is no longer valid.");

    const accessToken = await this.tokenService.signAccessToken({
      sub: user.id,
      role: user.role,
      plan: "free",
      tv: user.tokenVersion,
    });
    const refreshPair = this.tokenService.generateRefreshToken();

    await tx.insert(refreshTokens).values({
      userId: parent.userId,
      familyId: parent.familyId,
      tokenHash: refreshPair.hash,
      deviceFingerprint,
      deviceLabel: parent.deviceLabel,
      ipCountry: parent.ipCountry,
      parentId: parent.id,
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
    });

    return {
      access_token: accessToken,
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshPair.token,
      token_type: "Bearer",
    };
  }

  private async revokeFamily(db: DbOrTx, familyId: string): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: this.clock.now() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  // Used by OAuthService (P5.5) to start a brand-new session family after
  // a successful provider exchange — the same shape as AuthService's own
  // (separately maintained) issuance for register/login/otp-verify, but
  // OAuth has no password-hash timing-normalisation concerns so it's
  // simpler to keep as its own small method here rather than share one.
  async issueNewFamily(
    userId: string,
    role: string,
    tokenVersion: number,
    deviceFingerprint: string,
  ): Promise<TokensResponse> {
    const now = this.clock.now();
    const accessToken = await this.tokenService.signAccessToken({
      sub: userId,
      role,
      plan: "free",
      tv: tokenVersion,
    });
    const refreshPair = this.tokenService.generateRefreshToken();

    await this.postgres.db.insert(refreshTokens).values({
      userId,
      familyId: uuidv7(),
      tokenHash: refreshPair.hash,
      deviceFingerprint,
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
    });

    return {
      access_token: accessToken,
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshPair.token,
      token_type: "Bearer",
    };
  }

  // Used by the controller to mark the caller's own session `current` in
  // listSessions() — the cookie identifies a token, not a family, directly.
  async findFamilyIdByRawToken(rawToken: string): Promise<string | null> {
    const tokenHash = this.tokenService.hashRefreshToken(rawToken);
    const [row] = await this.postgres.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);
    return row?.familyId ?? null;
  }
}
