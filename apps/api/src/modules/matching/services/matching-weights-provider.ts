import { auditLogs, matchingWeightConfigs } from "@convene/db";
import { DEFAULT_WEIGHTS, isValidWeights, type MatchingWeights } from "@convene/matching";
import { Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import type { AuditRequestContext } from "../../../common/audit/audit-request-context";
import { CacheService } from "../../../common/cache/cache.service";
import { ValidationAppError } from "../../../common/errors/app-error";
import { PostgresService } from "../../../infra/postgres/postgres.service";

const WEIGHTS_CACHE_KEY = "matching_weights_active";
const WEIGHTS_CACHE_TTL_SECONDS = 5 * 60;

export interface ProposeWeightsResult {
  accepted: boolean;
  weights: MatchingWeights;
  reason?: string;
}

// PRD AD-8: "Matching weights live in remote config, not code ... enables
// experimentation without deploys" — Flagsmith is the named production
// backend (§21.2's tooling table), but no live Flagsmith instance is part
// of this codebase's dev/test environment. This is the same "local
// provider now, real backend later, same interface" precedent as P5.1's
// LocalFileKeyProvider (KMS) and P8.2's ComplementarityService (5-min
// in-process-LRU-then-Postgres, reused verbatim here) — a production
// FlagsmithMatchingWeightsProvider satisfying this same shape is
// explicitly out of this phase's scope to stand up.
@Injectable()
export class MatchingWeightsProvider {
  constructor(
    private readonly postgres: PostgresService,
    private readonly cache: CacheService,
  ) {}

  async getActiveWeights(): Promise<MatchingWeights> {
    return this.cache.getOrSet(WEIGHTS_CACHE_KEY, WEIGHTS_CACHE_TTL_SECONDS, async () => {
      const [row] = await this.postgres.db
        .select({ weights: matchingWeightConfigs.weights })
        .from(matchingWeightConfigs)
        .where(eq(matchingWeightConfigs.isActive, true))
        .orderBy(desc(matchingWeightConfigs.createdAt))
        .limit(1);
      // No config has ever been successfully proposed yet — DEFAULT_WEIGHTS
      // (the launch defaults, §11.3) is the fallback, exactly as
      // weights.ts's own doc comment states.
      return (row?.weights as MatchingWeights | undefined) ?? DEFAULT_WEIGHTS;
    });
  }

  // PRD §11.11/AD-8: "every change written to audit_logs and rejected
  // unless the weights sum to 1.00." A rejected proposal never reaches
  // matching_weight_configs at all — "the previous config remains active"
  // is true by construction (nothing about it changed), not a rollback
  // this method has to perform.
  // P18.3: `context` (ip/user-agent/request-id) is optional so this
  // method's signature stays backward compatible with any caller that
  // predates the audit envelope's full shape — every field still gets
  // `null` in that case rather than a caller-breaking required param.
  // Both audit_logs inserts stay on `this.postgres.db`/`tx` directly
  // (not routed through AuditLogService/AuditLogRepository, which own a
  // separate connection) because the accepted-path insert must commit
  // atomically with the weight-config change inside the same transaction
  // — going through the service would silently break that atomicity.
  // P26.2: `changeReason` is the admin's own stated rationale (design.md
  // §14.20's "mandatory change reason") — distinct from the rejected
  // branch's auto-generated diagnostic `reason` below, which explains
  // *why the schema said no*, not what the admin was trying to do. A
  // rejected proposal never took effect, so there's nothing for the
  // admin's own reason to attach to in the audit trail; only the
  // accepted path stores it.
  async proposeWeights(
    weights: MatchingWeights,
    actorUserId: string,
    changeReason: string,
    context?: AuditRequestContext,
  ): Promise<ProposeWeightsResult> {
    if (!isValidWeights(weights)) {
      const sum = Object.values(weights).reduce((total, weight) => total + weight, 0);
      const reason = `Weights must sum to 1.00, got ${sum}`;
      await this.postgres.db.insert(auditLogs).values({
        actorId: actorUserId,
        actorType: "admin",
        action: "matching_weights.rejected",
        entityType: "matching_weight_config",
        entityId: null,
        reason,
        before: await this.getActiveWeights(),
        after: weights,
        ip: context?.ip ?? null,
        userAgent: context?.userAgent ?? null,
        requestId: context?.requestId ?? null,
      });
      return { accepted: false, weights: await this.getActiveWeights(), reason };
    }

    const previous = await this.getActiveWeights();

    await this.postgres.db.transaction(async (tx) => {
      await tx
        .update(matchingWeightConfigs)
        .set({ isActive: false })
        .where(eq(matchingWeightConfigs.isActive, true));
      const [inserted] = await tx
        .insert(matchingWeightConfigs)
        .values({ weights, isActive: true, createdBy: actorUserId })
        .returning({ id: matchingWeightConfigs.id });

      await tx.insert(auditLogs).values({
        actorId: actorUserId,
        actorType: "admin",
        action: "matching_weights.updated",
        entityType: "matching_weight_config",
        entityId: inserted?.id ?? null,
        reason: changeReason,
        before: previous,
        after: weights,
        ip: context?.ip ?? null,
        userAgent: context?.userAgent ?? null,
        requestId: context?.requestId ?? null,
      });
    });

    await this.cache.invalidate(WEIGHTS_CACHE_KEY);
    return { accepted: true, weights };
  }

  // P26.2: "rollback to the previous configuration in one action."
  // matching_weight_configs is append-only (every accepted proposal adds
  // a row, `isActive` just moves) — the row immediately before the
  // current active one, ordered by createdAt, *is* "the previous
  // configuration." Rolling back inserts a fresh row with those same
  // weights (through the same accept path as proposeWeights, so it gets
  // its own audit row) rather than reactivating the old row in place —
  // consistent with this table never being mutated after the fact
  // outside of the isActive flip.
  async rollbackWeights(
    actorUserId: string,
    changeReason: string,
    context?: AuditRequestContext,
  ): Promise<ProposeWeightsResult> {
    const recent = await this.postgres.db
      .select({ weights: matchingWeightConfigs.weights })
      .from(matchingWeightConfigs)
      .orderBy(desc(matchingWeightConfigs.createdAt))
      .limit(2);

    if (recent.length < 2) {
      throw new ValidationAppError(
        "NO_PREVIOUS_WEIGHTS_CONFIG",
        "There's no previous configuration to roll back to.",
      );
    }

    const current = await this.getActiveWeights();
    const previous = recent[1]!.weights as MatchingWeights;

    await this.postgres.db.transaction(async (tx) => {
      await tx
        .update(matchingWeightConfigs)
        .set({ isActive: false })
        .where(eq(matchingWeightConfigs.isActive, true));
      const [inserted] = await tx
        .insert(matchingWeightConfigs)
        .values({ weights: previous, isActive: true, createdBy: actorUserId })
        .returning({ id: matchingWeightConfigs.id });

      await tx.insert(auditLogs).values({
        actorId: actorUserId,
        actorType: "admin",
        action: "matching_weights.rolled_back",
        entityType: "matching_weight_config",
        entityId: inserted?.id ?? null,
        reason: changeReason,
        before: current,
        after: previous,
        ip: context?.ip ?? null,
        userAgent: context?.userAgent ?? null,
        requestId: context?.requestId ?? null,
      });
    });

    await this.cache.invalidate(WEIGHTS_CACHE_KEY);
    return { accepted: true, weights: previous };
  }
}
