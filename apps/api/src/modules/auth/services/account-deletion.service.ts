import { users } from "@convene/db";
import { Injectable, Optional } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { AuditLogRepository } from "../../../common/audit/audit-log.repository";
import { type Clock, systemClock } from "../../../common/clock";
import { PostgresService } from "../../../infra/postgres/postgres.service";
import { RefreshService } from "./refresh.service";

const GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export interface RequestDeletionResult {
  purgeScheduledAt: Date;
}

// PRD §10.1.7 endpoint 11 / BR-AUTH-10 / §20.6 "Erasure": request enters a
// 30-day soft-delete state — status flips to 'deleted' *immediately*
// (this is what makes the profile invisible everywhere and conversations
// show "Account deleted" the instant the request lands, not at purge
// time), every session is revoked, and `purge_at` is set for a retention
// worker to hard-purge later. That worker (a scheduled job) is out of
// this endpoint's scope — see migrations/0007_erasure_retention_fks.sql
// for the FK changes that make a *future* hard purge honour §20.6's
// retention exceptions (financial records, upheld safety records, and
// anonymised-not-destroyed message copies) when it's built.
@Injectable()
export class AccountDeletionService {
  constructor(
    private readonly postgres: PostgresService,
    private readonly refreshService: RefreshService,
    @Optional() private readonly clock: Clock = systemClock,
    @Optional() private readonly auditLog?: AuditLogRepository,
  ) {}

  async requestDeletion(userId: string): Promise<RequestDeletionResult> {
    const now = this.clock.now();
    const purgeAt = new Date(now.getTime() + GRACE_PERIOD_MS);

    await this.postgres.db
      .update(users)
      .set({ status: "deleted", deletionRequestedAt: now, purgeAt })
      .where(eq(users.id, userId));

    await this.refreshService.logoutAll(userId);

    // §20.8: "every data export and deletion."
    await this.auditLog?.record({
      actorId: userId,
      actorType: "user",
      action: "account.deletion_requested",
      entityType: "user",
      entityId: userId,
      after: { purge_at: purgeAt.toISOString() },
    });

    return { purgeScheduledAt: purgeAt };
  }

  // PRD §10.1.7 endpoint 11 (cancel-delete): "one-tap cancel" during the
  // grace window restores full access. Reverting unconditionally to
  // 'active' is a documented simplification — the schema has no
  // "status before deletion was requested" column, so a user who was
  // e.g. shadow_limited before requesting deletion returns as active
  // rather than shadow_limited; flagged rather than silently assumed.
  async cancelDeletion(userId: string): Promise<void> {
    const [user] = await this.postgres.db.select().from(users).where(eq(users.id, userId)).limit(1);
    // No pending deletion (never requested, or already hard-purged) — a
    // no-op rather than an error, but critically must NOT touch `status`:
    // otherwise this call could reactivate an account that's merely
    // suspended, which never went through requestDeletion() at all.
    if (!user?.deletionRequestedAt) return;

    await this.postgres.db
      .update(users)
      .set({ status: "active", deletionRequestedAt: null, purgeAt: null })
      .where(eq(users.id, userId));

    await this.auditLog?.record({
      actorId: userId,
      actorType: "user",
      action: "account.deletion_cancelled",
      entityType: "user",
      entityId: userId,
    });
  }
}
