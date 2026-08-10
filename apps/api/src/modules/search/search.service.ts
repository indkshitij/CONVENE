import {
  availabilityLive,
  blocks,
  industries,
  profiles,
  skills,
  userIntents,
  userSkills,
  users,
} from "@convene/db";
import { Injectable } from "@nestjs/common";
import { and, eq, ilike, notExists, or, sql } from "drizzle-orm";
import { PaymentRequiredAppError } from "../../common/errors/app-error";
import { PostgresService } from "../../infra/postgres/postgres.service";

// PRD §10.9.2's own filter list, split into what free vs Premium can use
// (§7.2). `q`/`intents`/`industry`/`availability` are free; everything
// else requires Premium — enforced here as a real 402 naming the exact
// filter (PREMIUM_FILTER_REQUIRED), not a silent drop, matching §13
// F11 trigger 2's "paywall naming the exact filter" requirement — the
// controller decides which param names count as premium-only, this
// service just enforces whatever list it's handed.

export interface SearchUsersInput {
  q: string;
  intents?: string[] | undefined;
  industry?: number | undefined;
  skills?: string[] | undefined;
  skillsOp?: "and" | "or" | undefined;
  minExp?: number | undefined;
  maxExp?: number | undefined;
  availability?: string | undefined;
  verifiedOnly?: boolean | undefined;
  cursor?: string | undefined;
}

export interface SearchResultRow {
  user_id: string;
  full_name: string;
  headline: string | null;
  job_title: string | null;
  company_name: string | null;
  verification_level: number;
  city_name: string | null;
}

export interface SearchUsersResult {
  results: SearchResultRow[];
  facets: { industries: { id: number; name: string; count: number }[] };
  total_estimate: number;
  next_cursor: string | null;
  applied_premium_filters: string[];
}

const PAGE_SIZE = 20;

@Injectable()
export class SearchService {
  constructor(private readonly postgres: PostgresService) {}

  // Real (if intentionally simple — ILIKE substring, not the PRD's
  // full Postgres FTS/vector orchestration §10.9.1 describes for a later
  // AI-search phase) implementation: no fabricated relevance scoring,
  // no invented facet math. `facets.industries` counts the SAME filtered
  // result set (a documented simplification — not "counts if you also
  // picked each industry," which would need N extra queries).
  async searchUsers(
    viewerId: string,
    plan: string,
    input: SearchUsersInput,
    appliedPremiumFilters: string[],
  ): Promise<SearchUsersResult> {
    const isPremium = plan !== "free";
    if (!isPremium && appliedPremiumFilters.length > 0) {
      throw new PaymentRequiredAppError(
        "PREMIUM_FILTER_REQUIRED",
        `Filtering by ${appliedPremiumFilters[0]} is a Premium feature.`,
        {
          details: { filter: appliedPremiumFilters[0] },
        },
      );
    }

    const needle = `%${input.q}%`;
    const conditions = [
      sql`${profiles.userId} <> ${viewerId}`,
      or(
        ilike(users.fullName, needle),
        ilike(profiles.headline, needle),
        ilike(profiles.about, needle),
      ),
      sql`${profiles.profileVisibility} IN ('public','authenticated')`,
      notExists(
        this.postgres.db
          .select({ one: sql`1` })
          .from(blocks)
          .where(
            or(
              and(eq(blocks.blockerId, viewerId), eq(blocks.blockedId, profiles.userId)),
              and(eq(blocks.blockerId, profiles.userId), eq(blocks.blockedId, viewerId)),
            ),
          ),
      ),
    ];

    if (input.industry) conditions.push(eq(profiles.industryId, input.industry));
    if (input.verifiedOnly) conditions.push(sql`${profiles.verificationLevel} >= 2`);
    if (input.minExp !== undefined)
      conditions.push(sql`${profiles.yearsExperience} >= ${input.minExp}`);
    if (input.maxExp !== undefined)
      conditions.push(sql`${profiles.yearsExperience} <= ${input.maxExp}`);

    if (input.availability) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${availabilityLive} WHERE ${availabilityLive.userId} = ${profiles.userId} AND ${availabilityLive.state} = ${input.availability})`,
      );
    }

    if (input.intents && input.intents.length > 0) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${userIntents} WHERE ${userIntents.userId} = ${profiles.userId} AND ${userIntents.status} = 'active' AND ${userIntents.type} IN (${sql.join(
          input.intents.map((type) => sql`${type}`),
          sql`, `,
        )}))`,
      );
    }

    if (input.skills && input.skills.length > 0) {
      const skillConditions = input.skills.map(
        (name) =>
          sql`EXISTS (SELECT 1 FROM ${userSkills} JOIN ${skills} ON ${skills.id} = ${userSkills.skillId} WHERE ${userSkills.userId} = ${profiles.userId} AND ${skills.name} ILIKE ${name})`,
      );
      conditions.push(
        input.skillsOp === "or"
          ? sql`(${sql.join(skillConditions, sql` OR `)})`
          : sql`(${sql.join(skillConditions, sql` AND `)})`,
      );
    }

    const rows = await this.postgres.db
      .select({
        user_id: profiles.userId,
        full_name: users.fullName,
        headline: profiles.headline,
        job_title: profiles.jobTitle,
        company_name: profiles.companyName,
        verification_level: profiles.verificationLevel,
      })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .where(and(...conditions))
      .orderBy(users.fullName)
      .limit(PAGE_SIZE + 1);

    const hasMore = rows.length > PAGE_SIZE;
    const page = rows.slice(0, PAGE_SIZE);

    const industryFacets = await this.postgres.db
      .select({ id: industries.id, name: industries.name, count: sql<number>`count(*)::int` })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .innerJoin(industries, eq(industries.id, profiles.industryId))
      .where(and(...conditions))
      .groupBy(industries.id, industries.name)
      .orderBy(sql`count(*) DESC`)
      .limit(10);

    return {
      results: page.map((row) => ({ ...row, city_name: null })),
      facets: { industries: industryFacets },
      total_estimate: page.length,
      next_cursor: hasMore ? (page[page.length - 1]?.user_id ?? null) : null,
      applied_premium_filters: appliedPremiumFilters,
    };
  }
}
