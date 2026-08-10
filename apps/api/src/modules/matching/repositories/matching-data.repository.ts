import {
  availabilityLive,
  availabilitySessions,
  feedImpressions,
  industries,
  interests as interestsTable,
  matchCandidates,
  profileEmbeddings,
  profiles,
  reputationScores,
  skills as skillsTable,
  subscriptions,
  userIntents,
  userInterests,
  userLanguages,
  userSkills,
  users,
} from "@convene/db";
import type {
  AccountStatus,
  AvailabilityState,
  FunctionalArea,
  IntentRef,
  LanguageEntry,
  LanguageProficiency,
  ProfileVisibility,
} from "@convene/matching";
import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { PostgresService } from "../../../infra/postgres/postgres.service";

export type VerificationLevel = "L0" | "L1" | "L2" | "L3" | "L4";
export type Plan = "free" | "premium" | "pro";

const VERIFICATION_LEVELS: readonly VerificationLevel[] = ["L0", "L1", "L2", "L3", "L4"];

// user_languages.proficiency uses ('basic','conversational','fluent','native')
// (chk_user_languages_proficiency); @convene/matching's LanguageProficiency
// uses ('basic','conversational','professional','native') per PRD §11.5.4's
// literal wording. 'fluent' -> 'professional' is this repository's mapping
// between the two vocabularies — the DB schema predates this scoring
// package and wasn't renamed to match it (out of scope to rename a shipped
// column for this phase).
const DB_TO_MATCHING_PROFICIENCY: Record<string, LanguageProficiency> = {
  native: "native",
  fluent: "professional",
  conversational: "conversational",
  basic: "basic",
};

const ACTIVITY_WINDOW_DAYS = 14;

// The DB-sourced subset of packages/matching's GateContext — everything
// except intentScore/passesInboundFilter/viewerIsMatch, which the caller
// (matching.service.ts) fills in itself since they need scoring/inbound-
// filter-service context this repository doesn't have.
export interface GateFacts {
  isBlockedEitherDirection: boolean;
  hasActiveSuppression: boolean;
  isConnectedOrPendingRequest: boolean;
  profileVisibility: ProfileVisibility;
  accountStatus: AccountStatus;
  profileCompletion: number;
  availabilityState: AvailabilityState;
  cooldownActiveUntil?: Date;
  lastSessionAt?: Date;
}

// Structurally identical to static-components.service.ts's
// StaticComponents — defined independently here (not imported) to avoid a
// circular module reference (that service imports this repository).
export interface PrecomputedComponents {
  skill: number;
  industry: number;
  exp: number;
  interest: number;
  mutual: number;
  lang: number;
}

@Injectable()
export class MatchingDataRepository {
  constructor(private readonly postgres: PostgresService) {}

  // PRD §11.5.2: "V = active, unpaused intents of viewer (or
  // session_intents if v has an active session with them)." sessionIntentIds
  // comes from availability_live.intent_ids when the user has an active
  // session — the caller resolves that first (loadAvailabilityLive).
  async loadIntentRefs(
    userId: string,
    sessionIntentIds?: readonly string[] | null,
  ): Promise<IntentRef[]> {
    const rows = await this.postgres.db
      .select({
        id: userIntents.id,
        type: userIntents.type,
        isPrimary: userIntents.isPrimary,
        detail: userIntents.detail,
      })
      .from(userIntents)
      .where(
        and(
          eq(userIntents.userId, userId),
          eq(userIntents.status, "active"),
          eq(userIntents.isPaused, false),
        ),
      );

    const scoped =
      sessionIntentIds && sessionIntentIds.length > 0
        ? rows.filter((row) => sessionIntentIds.includes(row.id))
        : rows;

    return scoped.map((row) => ({
      type: row.type,
      isPrimary: row.isPrimary,
      ...(row.detail ? { detail: row.detail } : {}),
    }));
  }

  // Batched sibling of loadIntentRefs, for the online scoring loop where
  // N+1 per-candidate intent queries would be wasteful (up to ~40
  // candidates per feed request). sessionIntentIdsByUser lets each user
  // independently be session-scoped or not, matching loadIntentRefs'
  // single-user semantics exactly.
  async loadIntentRefsForUsers(
    userIds: readonly string[],
    sessionIntentIdsByUser: ReadonlyMap<string, readonly string[] | null>,
  ): Promise<Map<string, IntentRef[]>> {
    const result = new Map<string, IntentRef[]>();
    if (userIds.length === 0) return result;

    const rows = await this.postgres.db
      .select({
        userId: userIntents.userId,
        id: userIntents.id,
        type: userIntents.type,
        isPrimary: userIntents.isPrimary,
        detail: userIntents.detail,
      })
      .from(userIntents)
      .where(
        and(
          inArray(userIntents.userId, userIds as string[]),
          eq(userIntents.status, "active"),
          eq(userIntents.isPaused, false),
        ),
      );

    const byUser = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byUser.get(row.userId) ?? [];
      list.push(row);
      byUser.set(row.userId, list);
    }

    for (const userId of userIds) {
      const userRows = byUser.get(userId) ?? [];
      const sessionIntentIds = sessionIntentIdsByUser.get(userId);
      const scoped =
        sessionIntentIds && sessionIntentIds.length > 0
          ? userRows.filter((row) => sessionIntentIds.includes(row.id))
          : userRows;
      result.set(
        userId,
        scoped.map((row) => ({
          type: row.type,
          isPrimary: row.isPrimary,
          ...(row.detail ? { detail: row.detail } : {}),
        })),
      );
    }
    return result;
  }

  async loadIntentMetadata(
    userId: string,
  ): Promise<{ requiredSkills?: string[]; seniorityRange?: { min: number; max: number } }> {
    const rows = await this.postgres.db
      .select({ metadata: userIntents.metadata })
      .from(userIntents)
      .where(
        and(
          eq(userIntents.userId, userId),
          eq(userIntents.status, "active"),
          eq(userIntents.type, "hiring"),
        ),
      )
      .limit(1);
    const metadata = rows[0]?.metadata as
      { required_skills?: string[]; seniority_range?: { min: number; max: number } } | undefined;
    if (!metadata) return {};
    return {
      ...(metadata.required_skills ? { requiredSkills: metadata.required_skills } : {}),
      ...(metadata.seniority_range ? { seniorityRange: metadata.seniority_range } : {}),
    };
  }

  // Batched: returns a bag of skill names, their functional areas
  // (skills.functional_area, seeded to exactly @convene/matching's
  // FunctionalArea enum — see packages/db/seeds/taxonomies.ts), and the
  // mean of the top-10 skills' embeddings (PRD §11.5.3's
  // meanVector(top10(V_skills))) — null when the user has no embedded skills.
  async loadSkillBundles(
    userIds: readonly string[],
  ): Promise<
    Map<
      string,
      { names: string[]; functionalAreas: FunctionalArea[]; meanEmbedding: number[] | null }
    >
  > {
    const result = new Map<
      string,
      { names: string[]; functionalAreas: FunctionalArea[]; meanEmbedding: number[] | null }
    >();
    if (userIds.length === 0) return result;

    const rows = await this.postgres.db
      .select({
        userId: userSkills.userId,
        name: skillsTable.name,
        functionalArea: skillsTable.functionalArea,
        embedding: skillsTable.embedding,
        position: userSkills.position,
      })
      .from(userSkills)
      .innerJoin(skillsTable, eq(skillsTable.id, userSkills.skillId))
      .where(inArray(userSkills.userId, userIds as string[]))
      .orderBy(userSkills.userId, userSkills.position);

    const byUser = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byUser.get(row.userId) ?? [];
      list.push(row);
      byUser.set(row.userId, list);
    }

    for (const [userId, skillRows] of byUser) {
      const top10 = skillRows.slice(0, 10);
      const vectors = top10.map((row) => row.embedding).filter((v): v is number[] => v !== null);
      result.set(userId, {
        names: skillRows.map((row) => row.name),
        functionalAreas: skillRows
          .map((row) => row.functionalArea)
          .filter((a): a is FunctionalArea => a !== null),
        meanEmbedding: vectors.length > 0 ? meanVector(vectors) : null,
      });
    }
    return result;
  }

  async loadInterests(userIds: readonly string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (userIds.length === 0) return result;
    const rows = await this.postgres.db
      .select({ userId: userInterests.userId, slug: interestsTable.slug })
      .from(userInterests)
      .innerJoin(interestsTable, eq(interestsTable.id, userInterests.interestId))
      .where(inArray(userInterests.userId, userIds as string[]));
    for (const row of rows) {
      const list = result.get(row.userId) ?? [];
      list.push(row.slug);
      result.set(row.userId, list);
    }
    return result;
  }

  async loadLanguages(userIds: readonly string[]): Promise<Map<string, LanguageEntry[]>> {
    const result = new Map<string, LanguageEntry[]>();
    if (userIds.length === 0) return result;
    const rows = await this.postgres.db
      .select({
        userId: userLanguages.userId,
        code: userLanguages.languageCode,
        proficiency: userLanguages.proficiency,
      })
      .from(userLanguages)
      .where(inArray(userLanguages.userId, userIds as string[]));
    for (const row of rows) {
      const proficiency = DB_TO_MATCHING_PROFICIENCY[row.proficiency ?? "basic"] ?? "basic";
      const list = result.get(row.userId) ?? [];
      list.push({ code: row.code, proficiency });
      result.set(row.userId, list);
    }
    return result;
  }

  async loadReputationScores(userIds: readonly string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (userIds.length === 0) return result;
    const rows = await this.postgres.db
      .select({ userId: reputationScores.userId, score: reputationScores.score })
      .from(reputationScores)
      .where(inArray(reputationScores.userId, userIds as string[]));
    for (const row of rows) result.set(row.userId, row.score);
    // reputation_scores.score defaults to 50 — a user with no row yet
    // (fresh account) gets that same default rather than an absent value.
    for (const userId of userIds) if (!result.has(userId)) result.set(userId, 50);
    return result;
  }

  async loadPlans(userIds: readonly string[]): Promise<Map<string, Plan>> {
    const result = new Map<string, Plan>();
    if (userIds.length === 0) return result;
    const rows = await this.postgres.db
      .select({ userId: subscriptions.userId, planCode: subscriptions.planCode })
      .from(subscriptions)
      .where(
        and(
          inArray(subscriptions.userId, userIds as string[]),
          inArray(subscriptions.status, ["trialing", "active", "past_due"]),
        ),
      );
    for (const row of rows) {
      if (row.userId) result.set(row.userId, normalisePlanCode(row.planCode));
    }
    // No subscription row (yet) = free — same default AuthContextService uses.
    for (const userId of userIds) if (!result.has(userId)) result.set(userId, "free");
    return result;
  }

  async loadProfileScoringFields(userIds: readonly string[]): Promise<
    Map<
      string,
      {
        yearsExperience: number;
        industryId: number | null;
        verificationLevel: VerificationLevel;
        createdAt: Date;
        companyName: string | null;
      }
    >
  > {
    const result = new Map<
      string,
      {
        yearsExperience: number;
        industryId: number | null;
        verificationLevel: VerificationLevel;
        createdAt: Date;
        companyName: string | null;
      }
    >();
    if (userIds.length === 0) return result;
    const rows = await this.postgres.db
      .select({
        userId: profiles.userId,
        yearsExperience: profiles.yearsExperience,
        industryId: profiles.industryId,
        verificationLevel: profiles.verificationLevel,
        createdAt: users.createdAt,
        companyName: profiles.companyName,
      })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .where(inArray(profiles.userId, userIds as string[]));
    for (const row of rows) {
      result.set(row.userId, {
        yearsExperience: Number(row.yearsExperience),
        industryId: row.industryId,
        verificationLevel: VERIFICATION_LEVELS[row.verificationLevel] ?? "L0",
        createdAt: row.createdAt,
        companyName: row.companyName,
      });
    }
    return result;
  }

  // PRD §11.8's exploration-slot eligibility needs "never shown to this
  // viewer" — feed_impressions is the record of what's already been shown.
  async loadEverShown(viewerId: string, candidateIds: readonly string[]): Promise<Set<string>> {
    const result = new Set<string>();
    if (candidateIds.length === 0) return result;
    const rows = await this.postgres.db
      .select({ candidateId: feedImpressions.candidateId })
      .from(feedImpressions)
      .where(
        and(
          eq(feedImpressions.userId, viewerId),
          inArray(feedImpressions.candidateId, candidateIds as string[]),
        ),
      );
    for (const row of rows) result.add(row.candidateId);
    return result;
  }

  async loadMutualConnectionCount(viewerId: string, candidateId: string): Promise<number> {
    const rows = await this.postgres.db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM connections c1
      JOIN connections c2
        ON (c2.user_a_id = c1.user_a_id OR c2.user_a_id = c1.user_b_id OR c2.user_b_id = c1.user_a_id OR c2.user_b_id = c1.user_b_id)
      WHERE c1.removed_at IS NULL AND c2.removed_at IS NULL
        AND (c1.user_a_id = ${viewerId} OR c1.user_b_id = ${viewerId})
        AND (c2.user_a_id = ${candidateId} OR c2.user_b_id = ${candidateId})
        AND c1.user_a_id <> c1.user_b_id
    `);
    return rows[0]?.count ?? 0;
  }

  // Batched sibling of loadMutualConnectionCount, for match-reasons
  // generation (up to a page's worth of candidates at once). Uses the
  // connection_edges view (§16.4 — a symmetric directed mirror of
  // connections) rather than duplicating the single-pair method's own
  // self-join: X is a mutual connection of (viewer, candidate) exactly
  // when an edge viewer->X and an edge X->candidate both exist.
  async loadMutualConnectionCounts(
    viewerId: string,
    candidateIds: readonly string[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (candidateIds.length === 0) return result;
    const rows = await this.postgres.db.execute<{ candidate_id: string; mutual_count: number }>(sql`
      SELECT ec.peer_id AS candidate_id, count(*)::int AS mutual_count
      FROM connection_edges ev
      JOIN connection_edges ec ON ec.user_id = ev.peer_id
      WHERE ev.user_id = ${viewerId} AND ec.peer_id IN ${candidateIds}
      GROUP BY ec.peer_id
    `);
    for (const row of rows) result.set(row.candidate_id, row.mutual_count);
    for (const id of candidateIds) if (!result.has(id)) result.set(id, 0);
    return result;
  }

  // Match-reasons display facts (§14.8 card anatomy / §11.10
  // generate_reasons' context) — first name (derived from full_name;
  // no dedicated first-name column exists), city name, industry name,
  // response rate. Batched in one query since these are all read-only
  // labels needed for a single page's worth of cards.
  async loadDisplayFacts(candidateIds: readonly string[]): Promise<
    Map<
      string,
      {
        firstName: string;
        cityName: string | null;
        industryName: string | null;
        responseRate: number | null;
      }
    >
  > {
    const result = new Map<
      string,
      {
        firstName: string;
        cityName: string | null;
        industryName: string | null;
        responseRate: number | null;
      }
    >();
    if (candidateIds.length === 0) return result;
    const rows = await this.postgres.db.execute<{
      user_id: string;
      full_name: string;
      city_name: string | null;
      industry_name: string | null;
      response_rate: string | null;
    }>(sql`
      SELECT u.id AS user_id, u.full_name, c.name AS city_name, i.name AS industry_name, r.response_rate
      FROM users u
      JOIN profiles p ON p.user_id = u.id
      LEFT JOIN cities c ON c.id = p.city_id
      LEFT JOIN industries i ON i.id = p.industry_id
      LEFT JOIN reputation_scores r ON r.user_id = u.id
      WHERE u.id IN ${candidateIds}
    `);
    for (const row of rows) {
      result.set(row.user_id, {
        firstName: row.full_name.split(" ")[0] ?? row.full_name,
        cityName: row.city_name,
        industryName: row.industry_name,
        responseRate: row.response_rate !== null ? Number(row.response_rate) : null,
      });
    }
    return result;
  }

  async loadActivity(
    userIds: readonly string[],
  ): Promise<Map<string, { activeDaysLast14: number; availabilitySessionsLast14: number }>> {
    const result = new Map<
      string,
      { activeDaysLast14: number; availabilitySessionsLast14: number }
    >();
    if (userIds.length === 0) return result;
    const since = new Date(Date.now() - ACTIVITY_WINDOW_DAYS * 86_400_000);

    const rows = await this.postgres.db.execute<{
      user_id: string;
      active_days: number;
      session_count: number;
    }>(sql`
      SELECT user_id,
             count(DISTINCT date_trunc('day', started_at))::int AS active_days,
             count(*)::int AS session_count
      FROM availability_sessions
      WHERE user_id IN ${userIds} AND started_at >= ${since.toISOString()}
      GROUP BY user_id
    `);
    for (const row of rows) {
      result.set(row.user_id, {
        activeDaysLast14: row.active_days,
        availabilitySessionsLast14: row.session_count,
      });
    }
    for (const userId of userIds) {
      if (!result.has(userId))
        result.set(userId, { activeDaysLast14: 0, availabilitySessionsLast14: 0 });
    }
    return result;
  }

  // PRD §11.5.4: adjacencyValue is a scalar the PRD withholds the seed
  // values for (only the schema's boolean-ish adjacency list is real —
  // see industries.adjacent_industry_ids). Same-industry -> 1.0 is exact;
  // "adjacent" -> a fixed mid-range value (0.5, within the stated
  // 0.15-0.75 band) and "not adjacent" -> the stated floor (0.15) are this
  // repository's own resolution of that gap, not a transcription.
  // domainOverlap (for cofounderComplementarity, §11.5.3) reuses the same
  // adjacency signal at different fixed points within its own "want HIGH
  // ~0.6-0.9" band, for the same reason (no industry embedding exists).
  async loadIndustryAdjacency(
    viewerIndustryId: number | null,
    candidateIndustryId: number | null,
  ): Promise<{ sameIndustry: boolean; adjacencyValue: number; domainOverlap: number }> {
    if (viewerIndustryId === null || candidateIndustryId === null) {
      return { sameIndustry: false, adjacencyValue: 0.15, domainOverlap: 0.3 };
    }
    if (viewerIndustryId === candidateIndustryId) {
      return { sameIndustry: true, adjacencyValue: 1.0, domainOverlap: 0.85 };
    }
    const [row] = await this.postgres.db
      .select({ adjacentIndustryIds: industries.adjacentIndustryIds })
      .from(industries)
      .where(eq(industries.id, viewerIndustryId))
      .limit(1);
    const isAdjacent = row?.adjacentIndustryIds.includes(candidateIndustryId) ?? false;
    return isAdjacent
      ? { sameIndustry: false, adjacencyValue: 0.5, domainOverlap: 0.7 }
      : { sameIndustry: false, adjacencyValue: 0.15, domainOverlap: 0.3 };
  }

  async loadAvailabilityLive(
    userIds: readonly string[],
  ): Promise<Map<string, typeof availabilityLive.$inferSelect>> {
    const result = new Map<string, typeof availabilityLive.$inferSelect>();
    if (userIds.length === 0) return result;
    const rows = await this.postgres.db
      .select()
      .from(availabilityLive)
      .where(inArray(availabilityLive.userId, userIds as string[]));
    for (const row of rows) result.set(row.userId, row);
    return result;
  }

  // Newest-window overlap for a scheduled candidate — the viewer's own
  // upcoming windows aren't modelled per-candidate here (out of P12.1's
  // scope: full timezone-normalised window overlap belongs to
  // availability's own schedule-recurrence.ts, not the scoring path);
  // this reads only whether *a* session exists and how far out it starts,
  // which is what availabilityScore's scheduled branch actually needs.
  async loadNextScheduledSession(userId: string): Promise<{ startsAt: Date } | null> {
    const [row] = await this.postgres.db
      .select({ startsAt: availabilitySessions.startedAt })
      .from(availabilitySessions)
      .where(
        and(
          eq(availabilitySessions.userId, userId),
          gte(availabilitySessions.startedAt, new Date()),
          eq(availabilitySessions.source, "schedule"),
        ),
      )
      .orderBy(availabilitySessions.startedAt)
      .limit(1);
    return row ? { startsAt: row.startsAt } : null;
  }

  async loadNewbieSignals(
    userIds: readonly string[],
  ): Promise<Map<string, { createdAt: Date; connectionCount: number }>> {
    const result = new Map<string, { createdAt: Date; connectionCount: number }>();
    if (userIds.length === 0) return result;
    const createdRows = await this.postgres.db
      .select({ id: users.id, createdAt: users.createdAt })
      .from(users)
      .where(inArray(users.id, userIds as string[]));
    const countRows = await this.postgres.db.execute<{ user_id: string; count: number }>(sql`
      SELECT user_id, count(*)::int AS count FROM (
        SELECT user_a_id AS user_id FROM connections WHERE user_a_id IN ${userIds} AND removed_at IS NULL
        UNION ALL
        SELECT user_b_id AS user_id FROM connections WHERE user_b_id IN ${userIds} AND removed_at IS NULL
      ) c
      GROUP BY user_id
    `);
    const countsByUser = new Map(countRows.map((row) => [row.user_id, row.count]));
    for (const row of createdRows) {
      result.set(row.id, {
        createdAt: row.createdAt,
        connectionCount: countsByUser.get(row.id) ?? 0,
      });
    }
    return result;
  }

  // PRD §11.5.4's interestVec(v) has no dedicated embedding infra of its
  // own — reuses the whole-profile embedding (headline+about+skills+
  // intents, P7.4) as the nearest available semantic signal, and also
  // backstops skillsScore's semanticSimilarity when a user has too few
  // embedded skills for a meaningful mean vector. Documented simplification,
  // not a transcription of a "profile embedding = interest embedding" claim
  // anywhere in the PRD.
  async loadProfileEmbeddings(userIds: readonly string[]): Promise<Map<string, number[]>> {
    const result = new Map<string, number[]>();
    if (userIds.length === 0) return result;
    const rows = await this.postgres.db
      .select({ userId: profileEmbeddings.userId, embedding: profileEmbeddings.embedding })
      .from(profileEmbeddings)
      .where(inArray(profileEmbeddings.userId, userIds as string[]));
    for (const row of rows) result.set(row.userId, row.embedding);
    return result;
  }

  // PRD §11.4 G1-G12 (minus G8/G9, which need scoring/inbound-filter
  // context this repository doesn't have — those are checked by the
  // caller). One batched query per candidate page rather than N
  // per-candidate round trips, mirroring candidate.repository.ts's own
  // inline EXISTS-subquery style for the block/suppression checks it
  // already runs at the SQL-recall stage; this re-verifies the same
  // facts (deliberately — recall may have come from the match_candidates
  // fast path, which was never gate-checked at all) plus the ones recall
  // never checked (relationship, status, cooldown, dormancy).
  async loadGateFacts(
    viewerId: string,
    candidateIds: readonly string[],
  ): Promise<Map<string, GateFacts>> {
    const result = new Map<string, GateFacts>();
    if (candidateIds.length === 0) return result;

    const rows = await this.postgres.db.execute<{
      candidate_id: string;
      profile_visibility: string;
      profile_completion: number;
      account_status: string;
      availability_state: string | null;
      is_blocked: boolean;
      has_suppression: boolean;
      is_connected: boolean;
      has_pending_request: boolean;
      // MAX() over a correlated subquery doesn't come back auto-parsed as
      // a JS Date the way a plain column read does — postgres-js infers
      // the wire type from the query's own field descriptions, and an
      // aggregate over a subquery apparently doesn't carry the same OID
      // metadata (caught for real against Postgres, not by the type
      // annotation alone — see the `new Date(...)` wrapping below).
      last_rejected_at: string | null;
      last_removed_at: string | null;
      last_session_at: string | null;
    }>(sql`
      SELECT
        p.user_id AS candidate_id,
        p.profile_visibility,
        p.profile_completion,
        u.status AS account_status,
        al.state AS availability_state,
        EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = p.user_id) OR (b.blocker_id = p.user_id AND b.blocked_id = ${viewerId})) AS is_blocked,
        EXISTS (SELECT 1 FROM match_suppressions s WHERE s.user_id = ${viewerId} AND s.suppressed_id = p.user_id AND s.expires_at > now()) AS has_suppression,
        EXISTS (SELECT 1 FROM connections c WHERE c.removed_at IS NULL AND ((c.user_a_id = ${viewerId} AND c.user_b_id = p.user_id) OR (c.user_a_id = p.user_id AND c.user_b_id = ${viewerId}))) AS is_connected,
        EXISTS (SELECT 1 FROM connection_requests cr WHERE cr.status = 'pending' AND ((cr.sender_id = ${viewerId} AND cr.recipient_id = p.user_id) OR (cr.sender_id = p.user_id AND cr.recipient_id = ${viewerId}))) AS has_pending_request,
        (SELECT max(cr2.responded_at) FROM connection_requests cr2 WHERE cr2.status = 'rejected' AND cr2.sender_id = ${viewerId} AND cr2.recipient_id = p.user_id) AS last_rejected_at,
        (SELECT max(c3.removed_at) FROM connections c3 WHERE c3.removed_at IS NOT NULL AND ((c3.user_a_id = ${viewerId} AND c3.user_b_id = p.user_id) OR (c3.user_a_id = p.user_id AND c3.user_b_id = ${viewerId}))) AS last_removed_at,
        (SELECT max(sess.started_at) FROM availability_sessions sess WHERE sess.user_id = p.user_id) AS last_session_at
      FROM profiles p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN availability_live al ON al.user_id = p.user_id
      WHERE p.user_id IN ${candidateIds}
    `);

    for (const row of rows) {
      const lastRejectedAt = row.last_rejected_at ? new Date(row.last_rejected_at) : null;
      const lastRemovedAt = row.last_removed_at ? new Date(row.last_removed_at) : null;
      const lastSessionAt = row.last_session_at ? new Date(row.last_session_at) : null;

      const rejectedCooldownUntil = lastRejectedAt
        ? new Date(lastRejectedAt.getTime() + 30 * 86_400_000)
        : null;
      const removedCooldownUntil = lastRemovedAt
        ? new Date(lastRemovedAt.getTime() + 7 * 86_400_000)
        : null;
      const cooldownActiveUntil = [rejectedCooldownUntil, removedCooldownUntil]
        .filter((d): d is Date => d !== null)
        .sort((a, b) => b.getTime() - a.getTime())[0];

      result.set(row.candidate_id, {
        isBlockedEitherDirection: row.is_blocked,
        hasActiveSuppression: row.has_suppression,
        isConnectedOrPendingRequest: row.is_connected || row.has_pending_request,
        profileVisibility: row.profile_visibility as GateFacts["profileVisibility"],
        accountStatus: row.account_status as GateFacts["accountStatus"],
        profileCompletion: row.profile_completion,
        availabilityState: (row.availability_state ?? "offline") as GateFacts["availabilityState"],
        ...(cooldownActiveUntil ? { cooldownActiveUntil } : {}),
        ...(lastSessionAt ? { lastSessionAt } : {}),
      });
    }
    return result;
  }

  // PRD §11.7 R2a: "precomputed set (fast path)." Ordered by static_score
  // DESC (idx_mc_user_score) so the online path's own limit naturally
  // takes the best-precomputed-ranked candidates first.
  async loadPrecomputedCandidates(
    viewerId: string,
    limit: number,
  ): Promise<
    Array<{ candidateId: string; staticScore: number; components: PrecomputedComponents }>
  > {
    const rows = await this.postgres.db
      .select({
        candidateId: matchCandidates.candidateId,
        staticScore: matchCandidates.staticScore,
        components: matchCandidates.components,
      })
      .from(matchCandidates)
      .where(eq(matchCandidates.userId, viewerId))
      .orderBy(desc(matchCandidates.staticScore))
      .limit(limit);
    return rows.map((row) => ({
      candidateId: row.candidateId,
      staticScore: Number(row.staticScore),
      components: row.components as PrecomputedComponents,
    }));
  }

  async loadLocationContext(userIds: readonly string[]): Promise<
    Map<
      string,
      {
        cityId: number | null;
        stateId: number | null;
        countryCode: string | null;
        isHiddenLocation: boolean;
        remotePreference: "onsite" | "hybrid" | "remote" | "any";
        openToRelocate: boolean;
      }
    >
  > {
    const result = new Map<
      string,
      {
        cityId: number | null;
        stateId: number | null;
        countryCode: string | null;
        isHiddenLocation: boolean;
        remotePreference: "onsite" | "hybrid" | "remote" | "any";
        openToRelocate: boolean;
      }
    >();
    if (userIds.length === 0) return result;

    const rows = await this.postgres.db.execute<{
      user_id: string;
      city_id: number | null;
      state_id: number | null;
      country_code: string | null;
      location_privacy: string;
      remote_preference: "onsite" | "hybrid" | "remote" | "any";
      open_to_relocate: boolean;
    }>(sql`
      SELECT p.user_id, p.city_id, c.state_id, p.country_code, p.location_privacy, p.remote_preference, p.open_to_relocate
      FROM profiles p
      LEFT JOIN cities c ON c.id = p.city_id
      WHERE p.user_id IN ${userIds}
    `);
    for (const row of rows) {
      result.set(row.user_id, {
        cityId: row.city_id,
        stateId: row.state_id,
        countryCode: row.country_code,
        isHiddenLocation: row.location_privacy === "hidden",
        remotePreference: row.remote_preference,
        openToRelocate: row.open_to_relocate,
      });
    }
    return result;
  }

  async loadActiveUserIds(): Promise<string[]> {
    const rows = await this.postgres.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.status, "active"));
    return rows.map((row) => row.id);
  }

  // PRD §11.4 G7 / §11.9 cold start: "profile_completion < 40" is the
  // discovery-eligibility floor every recall query already gates
  // candidates on — this is that same check applied to the *viewer*,
  // for the discovery endpoints' own "profile_incomplete" empty state.
  async loadProfileCompletion(userId: string): Promise<number | null> {
    const [row] = await this.postgres.db
      .select({ profileCompletion: profiles.profileCompletion })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    return row?.profileCompletion ?? null;
  }
}

function normalisePlanCode(planCode: string): Plan {
  if (planCode === "pro") return "pro";
  if (planCode === "premium") return "premium";
  return "free";
}

function meanVector(vectors: readonly number[][]): number[] {
  const dimensions = vectors[0]!.length;
  const mean = new Array<number>(dimensions).fill(0);
  for (const vector of vectors) {
    for (let i = 0; i < dimensions; i++) mean[i] = mean[i]! + vector[i]!;
  }
  for (let i = 0; i < dimensions; i++) mean[i] = mean[i]! / vectors.length;
  const norm = Math.sqrt(mean.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return mean;
  return mean.map((v) => v / norm);
}
