import { computeFairnessShares, type FairnessGroupResult } from "@convene/matching";
import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { PostgresService } from "../../../infra/postgres/postgres.service";

export interface FairnessAuditResult {
  byVerificationLevel: FairnessGroupResult[];
  byCity: FairnessGroupResult[];
  byExperienceBand: FairnessGroupResult[];
  byReputationBand: FairnessGroupResult[];
  anyFlagged: boolean;
}

// PRD §11.11: "quarterly ... flag any group whose median impression share
// deviates > 25% from its population share," instrumented from day one
// per P12.3's own goal. Population is every profile eligible for
// discovery at all (profile_completion >= 40 — the same floor
// candidate.repository.ts's own recall SQL already gates every stage on,
// G7) — a candidate who could never be shown shouldn't count against
// "under-representation." Impressions are the cumulative feed_impressions
// count for candidates in that group, not a distinct-viewer count (a
// group shown repeatedly to the same few viewers is exactly the kind of
// skew this audit exists to catch).
@Injectable()
export class FairnessAuditService {
  constructor(private readonly postgres: PostgresService) {}

  async runAudit(): Promise<FairnessAuditResult> {
    const [byVerificationLevel, byCity, byExperienceBand, byReputationBand] = await Promise.all([
      this.auditByVerificationLevel(),
      this.auditByCity(),
      this.auditByExperienceBand(),
      this.auditByReputationBand(),
    ]);

    const anyFlagged = [byVerificationLevel, byCity, byExperienceBand, byReputationBand].some(
      (dimension) => dimension.some((row) => row.flagged),
    );

    return { byVerificationLevel, byCity, byExperienceBand, byReputationBand, anyFlagged };
  }

  private async auditByVerificationLevel(): Promise<FairnessGroupResult[]> {
    const rows = await this.postgres.db.execute<{
      group: string;
      population_count: number;
      impression_count: number;
    }>(sql`
      SELECT p.verification_level::text AS group,
             count(DISTINCT p.user_id)::int AS population_count,
             COALESCE(SUM(fi.count), 0)::int AS impression_count
      FROM profiles p
      LEFT JOIN feed_impressions fi ON fi.candidate_id = p.user_id
      WHERE p.profile_completion >= 40
      GROUP BY p.verification_level
    `);
    return computeFairnessShares(rows.map(toFairnessInput));
  }

  private async auditByCity(): Promise<FairnessGroupResult[]> {
    const rows = await this.postgres.db.execute<{
      group: string;
      population_count: number;
      impression_count: number;
    }>(sql`
      SELECT COALESCE(c.name, 'unknown') AS group,
             count(DISTINCT p.user_id)::int AS population_count,
             COALESCE(SUM(fi.count), 0)::int AS impression_count
      FROM profiles p
      LEFT JOIN cities c ON c.id = p.city_id
      LEFT JOIN feed_impressions fi ON fi.candidate_id = p.user_id
      WHERE p.profile_completion >= 40
      GROUP BY COALESCE(c.name, 'unknown')
    `);
    return computeFairnessShares(rows.map(toFairnessInput));
  }

  // PRD §11.11 names "years-of-experience decile"; P12.3's own prompt
  // narrows this to "experience band" — five bands rather than ten
  // deciles, since deciles need the full population's distribution
  // computed first (a second query) for no real audit-sensitivity gain
  // at this stage. Boundaries chosen to roughly mirror the sub-score
  // tolerance bands already used in subscores/experience.ts (~5-7 years).
  private async auditByExperienceBand(): Promise<FairnessGroupResult[]> {
    const rows = await this.postgres.db.execute<{
      group: string;
      population_count: number;
      impression_count: number;
    }>(sql`
      SELECT CASE
               WHEN p.years_experience < 2 THEN '0-2'
               WHEN p.years_experience < 5 THEN '2-5'
               WHEN p.years_experience < 10 THEN '5-10'
               WHEN p.years_experience < 20 THEN '10-20'
               ELSE '20+'
             END AS group,
             count(DISTINCT p.user_id)::int AS population_count,
             COALESCE(SUM(fi.count), 0)::int AS impression_count
      FROM profiles p
      LEFT JOIN feed_impressions fi ON fi.candidate_id = p.user_id
      WHERE p.profile_completion >= 40
      GROUP BY 1
    `);
    return computeFairnessShares(rows.map(toFairnessInput));
  }

  // Reputation quartile bands — reputation_scores.score defaults to 50 for
  // any profile with no row yet, matching MatchingDataRepository's own
  // default (loadReputationScores).
  private async auditByReputationBand(): Promise<FairnessGroupResult[]> {
    const rows = await this.postgres.db.execute<{
      group: string;
      population_count: number;
      impression_count: number;
    }>(sql`
      SELECT CASE
               WHEN COALESCE(r.score, 50) < 25 THEN '0-24'
               WHEN COALESCE(r.score, 50) < 50 THEN '25-49'
               WHEN COALESCE(r.score, 50) < 75 THEN '50-74'
               ELSE '75-100'
             END AS group,
             count(DISTINCT p.user_id)::int AS population_count,
             COALESCE(SUM(fi.count), 0)::int AS impression_count
      FROM profiles p
      LEFT JOIN reputation_scores r ON r.user_id = p.user_id
      LEFT JOIN feed_impressions fi ON fi.candidate_id = p.user_id
      WHERE p.profile_completion >= 40
      GROUP BY 1
    `);
    return computeFairnessShares(rows.map(toFairnessInput));
  }
}

function toFairnessInput(row: {
  group: string;
  population_count: number;
  impression_count: number;
}) {
  return {
    group: row.group,
    impressionCount: row.impression_count,
    populationCount: row.population_count,
  };
}
