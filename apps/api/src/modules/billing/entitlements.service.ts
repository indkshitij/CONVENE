import { userIntents } from "@convene/db";
import { Injectable } from "@nestjs/common";
import { and, count, eq } from "drizzle-orm";
import { getIntentLimit } from "../intents/plan-limits";
import { ConnectionQuotaService } from "../connections/services/connection-quota.service";
import { ConnectionsRepository } from "../connections/repositories/connections.repository";
import { PostgresService } from "../../infra/postgres/postgres.service";

const DEFAULT_TIMEZONE = "UTC";
const FREE_MAX_SESSION_DURATION_MINUTES = 120; // Mirrors availability.service.ts's own FREE_MAX_DURATION_MINUTES.
const FREE_MAX_SEARCH_RADIUS_KM = 100; // Mirrors location.ts's FREE_RADIUS_PRESETS_KM ceiling.

export interface EntitlementsResult {
  plan: string;
  limits: {
    daily_requests: number;
    active_intents: number;
    max_session_duration_minutes: number;
    max_search_radius_km: number;
  };
  usage: {
    daily_requests_used: number;
    active_intents_used: number;
  };
  features: {
    advanced_search_filters: boolean;
    who_viewed_me_full_list: boolean;
    custom_session_duration: boolean;
    custom_search_radius: boolean;
  };
}

// PRD §13 F11 / design.md §14.19's comparison table, read from the real
// enforcement points elsewhere in this codebase (connection-quota,
// plan-limits, availability, location) rather than re-declaring the
// numbers — every gated action must read entitlements from the server
// (this phase's own Implementation line), and this is that one source.
// `plan` is honestly always "free" (AuthContext.plan's own documented
// state until the billing module has real subscription rows) — never
// fabricated as anything else.
@Injectable()
export class EntitlementsService {
  constructor(
    private readonly postgres: PostgresService,
    private readonly quota: ConnectionQuotaService,
    private readonly connectionsRepository: ConnectionsRepository,
  ) {}

  async getEntitlements(
    userId: string,
    plan: string,
    now: Date = new Date(),
  ): Promise<EntitlementsResult> {
    const isPremium = plan !== "free";
    const timezone = (await this.connectionsRepository.loadTimezone(userId)) ?? DEFAULT_TIMEZONE;

    const [dailyQuota, activeIntentRows] = await Promise.all([
      this.quota.peekDailyQuota(userId, plan as "free" | "premium" | "pro", timezone, now),
      this.postgres.db
        .select({ activeIntentCount: count() })
        .from(userIntents)
        .where(and(eq(userIntents.userId, userId), eq(userIntents.status, "active"))),
    ]);
    const activeIntentCount = activeIntentRows[0]?.activeIntentCount ?? 0;

    return {
      plan,
      limits: {
        daily_requests: dailyQuota.limit,
        active_intents: getIntentLimit(plan),
        max_session_duration_minutes: isPremium ? 240 : FREE_MAX_SESSION_DURATION_MINUTES,
        max_search_radius_km: isPremium ? 500 : FREE_MAX_SEARCH_RADIUS_KM,
      },
      usage: {
        daily_requests_used: dailyQuota.used,
        active_intents_used: activeIntentCount,
      },
      features: {
        advanced_search_filters: isPremium,
        who_viewed_me_full_list: isPremium,
        custom_session_duration: isPremium,
        custom_search_radius: isPremium,
      },
    };
  }
}
