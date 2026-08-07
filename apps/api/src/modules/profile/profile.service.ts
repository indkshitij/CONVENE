import {
  auditLogs,
  availabilitySessions,
  blocks,
  certifications,
  cities,
  connectionRequests,
  connections,
  countries,
  education,
  experiences,
  industries,
  interests,
  matchCandidates,
  media,
  mutualConnectionCounts,
  portfolioItems,
  profiles,
  reputationScores,
  skills,
  states,
  userInterests,
  userIntents,
  userLanguages,
  users,
  userSkills,
  type NewProfile,
  type Profile,
  type User,
} from "@convene/db";
import { profile as profileValidation } from "@convene/validation";
import {
  DEFAULT_WEIGHTS,
  computeScore,
  exactSkillOverlap,
  generateReasons,
  industryScore,
  intentScore,
  languagesScore,
  mutualScore,
  type IndustryScoreInput,
  type IntentRef,
  type LanguageEntry,
  type ReasonContext,
  type SubScores,
} from "@convene/matching";
import { Injectable, Optional } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  ConflictAppError,
  ForbiddenAppError,
  NotFoundAppError,
  TooManyRequestsAppError,
} from "../../common/errors/app-error";
import { type Clock, systemClock } from "../../common/clock";
import { computeEtag } from "../../common/serialization/etag";
import { PostgresService } from "../../infra/postgres/postgres.service";
import { bucketDistanceKm } from "./location-bucket";
import { PROFILE_UPDATED_EVENT } from "./profile-events";

export type ProfileUpdateInput = z.infer<typeof profileValidation.profileUpdateSchema>;

const NAME_CHANGE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const NAME_CHANGE_LIMIT_PER_WINDOW = 2;

// exactOptionalPropertyTypes:true means an optional field must be either
// present-with-a-value or entirely absent — never explicitly `undefined`.
// This strips `undefined` values before constructing objects typed
// against packages/matching's optional fields (IntentRef.detail,
// IndustryScoreInput.adjacencyValue, ReasonContext's several optionals).
// The target type is given explicitly (rather than inferred from the
// input) since the input's own inferred type still carries the `|
// undefined` union that only the runtime filter below actually removes.
function omitUndefined<T extends object>(obj: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (obj[key] !== undefined) result[key] = obj[key];
  }
  return result as T;
}

// PRD §10.2.9/§14.14: a private profile and a nonexistent id must be
// indistinguishable — same status, same body. Chosen as 404 (not 403)
// since that's the literal copy §14.14 gives ("This profile isn't
// available") and is the more conservative choice for not hinting that
// *something* exists at this id. `403 BLOCKED` (§10.2.9's own error
// table) stays a distinct response — blocking implies a pre-existing
// relationship, so it isn't an enumeration vector the way private-vs-
// nonexistent is.
const PROFILE_UNAVAILABLE_MESSAGE = "This profile isn't available";

export type Relationship = "self" | "connected" | "matched" | "stranger";

export interface ProfileResponse {
  user_id: string;
  full_name: string;
  // Nullable: §10.2.2 marks this "required," but P5.2's registration flow
  // creates a profiles row before onboarding step 2 (which collects it)
  // ever runs, and the schema was relaxed to nullable for exactly that
  // window — see profiles.ts's own header comment.
  headline: string | null;
  about: string | null;
  avatar: { sm: string; md: string; lg: string } | null;
  industry: { id: number; label: string } | null;
  job_title: string | null;
  company: { name: string; verified: boolean } | null;
  years_experience: string;
  skills: { name: string; proficiency: string | null; years: string | null }[];
  interests: string[];
  languages: { code: string; proficiency: string | null }[];
  experience: {
    company: string;
    title: string;
    start_date: string;
    end_date: string | null;
    is_current: boolean;
  }[];
  education: { school: string; degree: string | null; field: string | null }[];
  certifications: { name: string; issuer: string }[];
  portfolio: { title: string; url: string }[];
  location: {
    city: string | null;
    state: string | null;
    country: string | null;
    timezone: string | null;
    distance_bucket: string | null;
  };
  verification: { level: number };
  // response_rate is numeric(4,3) in Postgres — drizzle maps numeric
  // columns to string (to avoid float precision loss), not number.
  reputation: {
    band: string;
    response_rate: string | null;
    median_response_minutes: number | null;
  };
  availability: { state: string; expires_at: string | null } | null;
  intents: { type: string; detail: string | null; expires_at: string }[];
  mutual_connections: { count: number };
  relationship: { status: Relationship; can_request: boolean };
  compatibility: { score: number; reasons: string[] } | null;
  profile_completion?: number;
}

@Injectable()
export class ProfileService {
  constructor(
    private readonly postgres: PostgresService,
    // See otp.service.ts's constructor comment: Clock is an interface, so
    // @Optional() is required for Nest DI to fall through to the default.
    @Optional() private readonly clock: Clock = systemClock,
    // Optional for the same reason tests across this codebase construct
    // services manually without every collaborator (see e.g.
    // profile.service.integration.test.ts) — EventEmitterModule.forRoot()
    // always provides a real one in the running app (app.module.ts, P7.4).
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  async getMyProfile(userId: string): Promise<ProfileResponse> {
    return this.buildResponse(userId, userId);
  }

  // PRD §10.2.9 endpoint 14: "PATCH /profiles/me — partial update,
  // optimistic concurrency via If-Match." The current ETag isn't a stored
  // column — EtagInterceptor (P3.2/P6.1) computes it from the full GET
  // response body — so validating If-Match means recomputing that same
  // representation server-side and hashing it identically (computeEtag,
  // shared with the interceptor) rather than comparing against a version
  // number.
  async updateMyProfile(
    userId: string,
    ifMatch: string,
    updates: ProfileUpdateInput,
  ): Promise<ProfileResponse> {
    const current = await this.getMyProfile(userId);
    const currentEtag = computeEtag(current);
    if (ifMatch !== currentEtag) {
      throw new ConflictAppError(
        "ETAG_MISMATCH",
        "This profile was changed since you last loaded it. Refresh and try again.",
      );
    }

    if (updates.full_name !== undefined && updates.full_name !== current.full_name) {
      await this.applyNameChange(userId, updates.full_name);
    }

    const profileUpdates = this.buildProfileColumnUpdates(updates);
    if (Object.keys(profileUpdates).length > 0) {
      await this.postgres.db
        .update(profiles)
        .set(profileUpdates)
        .where(eq(profiles.userId, userId));
    }

    this.emitProfileUpdated(userId, updates);

    return this.getMyProfile(userId);
  }

  // PRD §17.2 Profile module "Publishes: profile.updated." Fields named
  // are the request body's own snake_case keys — embedding-refresh.listener.ts
  // matches these directly against BR-PROF-09's literal field list rather
  // than this service needing to know anything about embeddings itself.
  private emitProfileUpdated(userId: string, updates: ProfileUpdateInput): void {
    const changedFields = Object.keys(updates).filter(
      (key) => updates[key as keyof ProfileUpdateInput] !== undefined,
    );
    if (changedFields.length === 0) return;
    this.events?.emit(PROFILE_UPDATED_EVENT, { userId, changedFields });
  }

  private buildProfileColumnUpdates(updates: ProfileUpdateInput): Partial<NewProfile> {
    const columnUpdates: Partial<NewProfile> = {};
    if (updates.headline !== undefined) columnUpdates.headline = updates.headline;
    if (updates.about !== undefined) columnUpdates.about = updates.about;
    if (updates.industry_id !== undefined) columnUpdates.industryId = updates.industry_id;
    if (updates.job_title !== undefined) columnUpdates.jobTitle = updates.job_title;
    if (updates.company_name !== undefined) columnUpdates.companyName = updates.company_name;
    if (updates.employment_type !== undefined)
      columnUpdates.employmentType = updates.employment_type;
    if (updates.years_experience !== undefined)
      columnUpdates.yearsExperience = String(updates.years_experience);
    if (updates.years_experience_override !== undefined) {
      columnUpdates.yearsExperienceOverride = updates.years_experience_override;
    }
    if (updates.timezone !== undefined) columnUpdates.timezone = updates.timezone;
    if (updates.remote_preference !== undefined)
      columnUpdates.remotePreference = updates.remote_preference;
    if (updates.open_to_relocate !== undefined)
      columnUpdates.openToRelocate = updates.open_to_relocate;
    if (updates.social_links !== undefined) columnUpdates.socialLinks = updates.social_links;
    if (Object.keys(columnUpdates).length > 0) columnUpdates.updatedAt = this.clock.now();
    return columnUpdates;
  }

  // BR-PROF-07: "Name changes are limited to 2 per 90 days; each is
  // audit-logged." users.name_change_count/name_change_window_started_at
  // (migrations/0008) implement the rolling window: it resets (to 1) once
  // the most recent change is more than 90 days after the window began,
  // otherwise increments and is capped at 2 within the window.
  private async applyNameChange(userId: string, newFullName: string): Promise<void> {
    const [user] = await this.postgres.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new NotFoundAppError("PROFILE_NOT_FOUND", PROFILE_UNAVAILABLE_MESSAGE);

    const now = this.clock.now();
    const windowStart = user.nameChangeWindowStartedAt;
    const windowExpired =
      !windowStart || now.getTime() - windowStart.getTime() > NAME_CHANGE_WINDOW_MS;

    let newCount: number;
    let newWindowStart: Date;
    if (windowExpired) {
      newCount = 1;
      newWindowStart = now;
    } else {
      if (user.nameChangeCount >= NAME_CHANGE_LIMIT_PER_WINDOW) {
        const retryAfterSeconds = Math.ceil(
          (windowStart.getTime() + NAME_CHANGE_WINDOW_MS - now.getTime()) / 1000,
        );
        throw new TooManyRequestsAppError(
          "NAME_CHANGE_LIMIT",
          "You've reached the limit of 2 name changes per 90 days.",
          { retryAfter: retryAfterSeconds },
        );
      }
      newCount = user.nameChangeCount + 1;
      newWindowStart = windowStart;
    }

    await this.postgres.db
      .update(users)
      .set({
        fullName: newFullName,
        nameChangeCount: newCount,
        nameChangeWindowStartedAt: newWindowStart,
      })
      .where(eq(users.id, userId));

    await this.postgres.db.insert(auditLogs).values({
      actorId: userId,
      actorType: "user",
      action: "profile.name_changed",
      entityType: "user",
      entityId: userId,
      before: { full_name: user.fullName },
      after: { full_name: newFullName },
    });
  }

  async getProfileForViewer(viewerId: string, targetUserId: string): Promise<ProfileResponse> {
    if (viewerId === targetUserId) return this.buildResponse(viewerId, targetUserId);

    const isBlocked = await this.isBlockedEitherWay(viewerId, targetUserId);
    if (isBlocked) {
      throw new ForbiddenAppError("BLOCKED", "You can't view this profile.");
    }

    const target = await this.loadUserAndProfile(targetUserId);
    if (!target) {
      throw new NotFoundAppError("PROFILE_NOT_FOUND", PROFILE_UNAVAILABLE_MESSAGE);
    }

    const relationship = await this.resolveRelationship(viewerId, targetUserId);
    if (!this.isVisibleTo(target.profile.profileVisibility, relationship)) {
      // Identical to the nonexistent-id branch above — same class, same
      // message, same code — so a private profile can't be distinguished
      // from one that doesn't exist at all.
      throw new NotFoundAppError("PROFILE_NOT_FOUND", PROFILE_UNAVAILABLE_MESSAGE);
    }

    return this.buildResponse(viewerId, targetUserId, relationship);
  }

  private isVisibleTo(profileVisibility: string, relationship: Relationship): boolean {
    switch (profileVisibility) {
      case "private":
        return false;
      case "connections_only":
        return relationship === "connected";
      case "matches_only":
        return relationship === "connected" || relationship === "matched";
      case "public":
      case "authenticated":
      default:
        // True unauthenticated/guest browsing (the distinction between
        // "public" and "authenticated") isn't wired yet — every caller of
        // this service is already past JwtAuthGuard, so both levels are
        // equivalent here until guest browsing exists.
        return true;
    }
  }

  private async isBlockedEitherWay(userA: string, userB: string): Promise<boolean> {
    const [row] = await this.postgres.db
      .select()
      .from(blocks)
      .where(
        or(
          and(eq(blocks.blockerId, userA), eq(blocks.blockedId, userB)),
          and(eq(blocks.blockerId, userB), eq(blocks.blockedId, userA)),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  private async resolveRelationship(viewerId: string, targetUserId: string): Promise<Relationship> {
    const [connectedRow] = await this.postgres.db
      .select()
      .from(connections)
      .where(
        and(
          or(
            and(eq(connections.userAId, viewerId), eq(connections.userBId, targetUserId)),
            and(eq(connections.userAId, targetUserId), eq(connections.userBId, viewerId)),
          ),
          isNull(connections.removedAt),
        ),
      )
      .limit(1);
    if (connectedRow) return "connected";

    const [matchCandidateRow] = await this.postgres.db
      .select()
      .from(matchCandidates)
      .where(
        or(
          and(eq(matchCandidates.userId, viewerId), eq(matchCandidates.candidateId, targetUserId)),
          and(eq(matchCandidates.userId, targetUserId), eq(matchCandidates.candidateId, viewerId)),
        ),
      )
      .limit(1);
    if (matchCandidateRow) return "matched";

    const [requestRow] = await this.postgres.db
      .select()
      .from(connectionRequests)
      .where(
        or(
          and(
            eq(connectionRequests.senderId, viewerId),
            eq(connectionRequests.recipientId, targetUserId),
          ),
          and(
            eq(connectionRequests.senderId, targetUserId),
            eq(connectionRequests.recipientId, viewerId),
          ),
        ),
      )
      .limit(1);
    if (requestRow) return "matched";

    return "stranger";
  }

  private async loadUserAndProfile(
    userId: string,
  ): Promise<{ user: User; profile: Profile } | null> {
    const [row] = await this.postgres.db
      .select({ user: users, profile: profiles })
      .from(users)
      .innerJoin(profiles, eq(profiles.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);
    return row ?? null;
  }

  private async buildResponse(
    viewerId: string,
    targetUserId: string,
    relationship?: Relationship,
  ): Promise<ProfileResponse> {
    const isSelf = viewerId === targetUserId;
    const resolvedRelationship =
      relationship ?? (isSelf ? "self" : await this.resolveRelationship(viewerId, targetUserId));

    const target = await this.loadUserAndProfile(targetUserId);
    if (!target) {
      throw new NotFoundAppError("PROFILE_NOT_FOUND", PROFILE_UNAVAILABLE_MESSAGE);
    }
    const { user, profile } = target;

    const [
      industry,
      avatarMedia,
      skillRows,
      interestRows,
      languageRows,
      experienceRows,
      educationRows,
      certificationRows,
      portfolioRows,
      locationInfo,
      reputationRow,
      availabilityRow,
      intentRows,
      mutualCount,
    ] = await Promise.all([
      profile.industryId
        ? this.postgres.db
            .select()
            .from(industries)
            .where(eq(industries.id, profile.industryId))
            .limit(1)
            .then((r) => r[0] ?? null)
        : null,
      profile.avatarMediaId
        ? this.postgres.db
            .select()
            .from(media)
            .where(eq(media.id, profile.avatarMediaId))
            .limit(1)
            .then((r) => r[0] ?? null)
        : null,
      this.postgres.db
        .select({
          name: skills.name,
          proficiency: userSkills.proficiency,
          years: userSkills.years,
          position: userSkills.position,
        })
        .from(userSkills)
        .innerJoin(skills, eq(skills.id, userSkills.skillId))
        .where(eq(userSkills.userId, targetUserId)),
      this.postgres.db
        .select({ name: interests.name })
        .from(userInterests)
        .innerJoin(interests, eq(interests.id, userInterests.interestId))
        .where(eq(userInterests.userId, targetUserId)),
      this.postgres.db
        .select({ code: userLanguages.languageCode, proficiency: userLanguages.proficiency })
        .from(userLanguages)
        .where(eq(userLanguages.userId, targetUserId)),
      this.postgres.db.select().from(experiences).where(eq(experiences.userId, targetUserId)),
      this.postgres.db.select().from(education).where(eq(education.userId, targetUserId)),
      this.postgres.db.select().from(certifications).where(eq(certifications.userId, targetUserId)),
      this.postgres.db.select().from(portfolioItems).where(eq(portfolioItems.userId, targetUserId)),
      this.resolveLocation(viewerId, targetUserId, profile),
      this.postgres.db
        .select()
        .from(reputationScores)
        .where(eq(reputationScores.userId, targetUserId))
        .limit(1)
        .then((r) => r[0] ?? null),
      this.postgres.db
        .select()
        .from(availabilitySessions)
        .where(
          and(eq(availabilitySessions.userId, targetUserId), isNull(availabilitySessions.endedAt)),
        )
        .limit(1)
        .then((r) => r[0] ?? null),
      this.postgres.db
        .select()
        .from(userIntents)
        .where(and(eq(userIntents.userId, targetUserId), eq(userIntents.status, "active"))),
      this.getMutualConnectionCount(viewerId, targetUserId),
    ]);

    const compatibility = isSelf
      ? null
      : await this.computeCompatibilityPreview(viewerId, targetUserId, {
          skills: skillRows.map((s) => s.name),
          industryId: profile.industryId,
          intents: intentRows.map((i) =>
            omitUndefined<IntentRef>({
              type: i.type,
              isPrimary: i.isPrimary,
              detail: i.detail ?? undefined,
            }),
          ),
          languages: languageRows,
          mutualCount,
          availabilityState: availabilityRow?.state ?? "offline",
          candidateFirstName: user.fullName.split(" ")[0] ?? user.fullName,
        });

    const response: ProfileResponse = {
      user_id: user.id,
      full_name: user.fullName,
      headline: profile.headline,
      about: profile.about,
      avatar: avatarMedia ? this.toAvatarDerivatives(avatarMedia.derivatives) : null,
      industry: industry ? { id: industry.id, label: industry.name } : null,
      job_title: profile.jobTitle,
      company: profile.companyName
        ? { name: profile.companyName, verified: profile.companyVerified }
        : null,
      years_experience: profile.yearsExperience,
      skills: skillRows
        .sort((a, b) => a.position - b.position)
        .map((s) => ({ name: s.name, proficiency: s.proficiency, years: s.years })),
      interests: interestRows.map((i) => i.name),
      languages: languageRows.map((l) => ({ code: l.code, proficiency: l.proficiency })),
      experience: experienceRows.map((e) => ({
        company: e.companyName,
        title: e.title,
        start_date: e.startDate,
        end_date: e.endDate,
        is_current: e.isCurrent,
      })),
      education: educationRows.map((e) => ({
        school: e.school,
        degree: e.degree,
        field: e.fieldOfStudy,
      })),
      certifications: certificationRows.map((c) => ({ name: c.name, issuer: c.issuer })),
      portfolio: portfolioRows.map((p) => ({ title: p.title, url: p.url })),
      location: locationInfo,
      verification: { level: profile.verificationLevel },
      reputation: {
        band: reputationRow?.band ?? "new",
        response_rate: reputationRow?.responseRate ?? null,
        median_response_minutes: reputationRow?.medianResponseMinutes ?? null,
      },
      availability: availabilityRow
        ? {
            state: availabilityRow.state,
            expires_at: availabilityRow.expiresAt?.toISOString() ?? null,
          }
        : null,
      intents: intentRows.map((i) => ({
        type: i.type,
        detail: i.detail,
        expires_at: i.expiresAt.toISOString(),
      })),
      mutual_connections: { count: mutualCount },
      relationship: {
        status: resolvedRelationship,
        can_request: !isSelf && resolvedRelationship !== "connected",
      },
      compatibility,
    };

    if (isSelf) {
      response.profile_completion = profile.profileCompletion;
    }

    return response;
  }

  // PRD §10.2.9: {sm,md,lg}. Real derivative generation is the media
  // pipeline's job (Phase 16); this only projects whatever URLs are
  // already on the media row's `derivatives` jsonb, defensively, since
  // that pipeline doesn't exist yet and the column could be empty.
  private toAvatarDerivatives(derivatives: unknown): { sm: string; md: string; lg: string } | null {
    if (!derivatives || typeof derivatives !== "object") return null;
    const d = derivatives as Record<string, unknown>;
    if (typeof d.sm !== "string" || typeof d.md !== "string" || typeof d.lg !== "string")
      return null;
    return { sm: d.sm, md: d.md, lg: d.lg };
  }

  // BR-LOC-02: distance is always server-computed and bucketed — the raw
  // coordinates are never selected into application code at all, only
  // used inside the SQL distance computation itself.
  private async resolveLocation(
    viewerId: string,
    targetUserId: string,
    profile: Profile,
  ): Promise<ProfileResponse["location"]> {
    const [cityRow] = profile.cityId
      ? await this.postgres.db
          .select({
            cityName: cities.name,
            stateName: states.name,
            countryCode: countries.code,
            countryName: countries.name,
          })
          .from(cities)
          .leftJoin(states, eq(states.id, cities.stateId))
          .leftJoin(countries, eq(countries.code, cities.countryCode))
          .where(eq(cities.id, profile.cityId))
          .limit(1)
      : [];

    let distanceBucket: string | null = null;
    if (profile.locationPrivacy !== "hidden" && viewerId !== targetUserId) {
      distanceBucket = await this.computeDistanceBucket(viewerId, targetUserId);
    }

    return {
      city: cityRow?.cityName ?? null,
      state: cityRow?.stateName ?? null,
      country: cityRow?.countryName ?? null,
      timezone: profile.timezone,
      distance_bucket: distanceBucket,
    };
  }

  private async computeDistanceBucket(
    viewerId: string,
    targetUserId: string,
  ): Promise<string | null> {
    // ST_Distance and the raw coordinates never leave this query — only a
    // bucketed label (via bucketDistanceKm) is ever returned to the
    // caller (BR-LOC-02). Joins through cities on both sides for the
    // same-country comparison since profiles has no country column of
    // its own — only city_id.
    const rows = await this.postgres.db.execute<{
      km: number | null;
      same_country: boolean | null;
    }>(sql`
      SELECT
        ST_Distance(a.coordinates, b.coordinates) / 1000.0 AS km,
        (ca.country_code = cb.country_code) AS same_country
      FROM profiles a
      JOIN profiles b ON true
      LEFT JOIN cities ca ON ca.id = a.city_id
      LEFT JOIN cities cb ON cb.id = b.city_id
      WHERE a.user_id = ${viewerId} AND b.user_id = ${targetUserId}
        AND a.coordinates IS NOT NULL AND b.coordinates IS NOT NULL
    `);
    const row = rows[0];
    if (!row || row.km === null) return null;
    return bucketDistanceKm(row.km, row.same_country ?? false);
  }

  private async getMutualConnectionCount(viewerId: string, targetUserId: string): Promise<number> {
    const [u1, u2] = viewerId < targetUserId ? [viewerId, targetUserId] : [targetUserId, viewerId];
    const [row] = await this.postgres.db
      .select()
      .from(mutualConnectionCounts)
      .where(and(eq(mutualConnectionCounts.u1, u1), eq(mutualConnectionCounts.u2, u2)))
      .limit(1);
    return row?.mutualCount ?? 0;
  }

  // A deliberately partial "preview" compatibility score — skill, industry,
  // intent, language and mutual-connection sub-scores only (5 of the 11 in
  // §11.3). The rest (availability overlap, location decay, semantic
  // interest similarity, activity, reputation) need infrastructure this
  // endpoint doesn't own (real-time availability windows, embeddings —
  // P7.4 — and the reputation engine — P18) and are Phase 12's job to wire
  // as a live candidate-ranking pipeline. computeScore()'s own weight
  // renormalisation is exactly designed for this partial-input case.
  private async computeCompatibilityPreview(
    viewerId: string,
    targetUserId: string,
    candidate: {
      skills: string[];
      industryId: number | null;
      intents: IntentRef[];
      languages: { code: string; proficiency: string | null }[];
      mutualCount: number;
      availabilityState: ReasonContext["candidateAvailabilityState"];
      candidateFirstName: string;
    },
  ): Promise<{ score: number; reasons: string[] } | null> {
    const viewer = await this.loadUserAndProfile(viewerId);
    if (!viewer) return null;

    const [
      viewerSkillRows,
      viewerIntentRows,
      viewerLanguageRows,
      viewerIndustry,
      candidateIndustry,
    ] = await Promise.all([
      this.postgres.db
        .select({ name: skills.name })
        .from(userSkills)
        .innerJoin(skills, eq(skills.id, userSkills.skillId))
        .where(eq(userSkills.userId, viewerId)),
      this.postgres.db
        .select()
        .from(userIntents)
        .where(and(eq(userIntents.userId, viewerId), eq(userIntents.status, "active"))),
      this.postgres.db.select().from(userLanguages).where(eq(userLanguages.userId, viewerId)),
      viewer.profile.industryId
        ? this.postgres.db
            .select()
            .from(industries)
            .where(eq(industries.id, viewer.profile.industryId))
            .limit(1)
            .then((r) => r[0] ?? null)
        : null,
      candidate.industryId
        ? this.postgres.db
            .select()
            .from(industries)
            .where(eq(industries.id, candidate.industryId))
            .limit(1)
            .then((r) => r[0] ?? null)
        : null,
    ]);

    const subScores: SubScores = {
      skill: exactSkillOverlap(
        viewerSkillRows.map((s) => s.name),
        candidate.skills,
      ),
      mutual: mutualScore(candidate.mutualCount),
    };

    if (viewer.profile.industryId && candidate.industryId) {
      const sameIndustry = viewer.profile.industryId === candidate.industryId;
      subScores.industry = industryScore(
        omitUndefined<IndustryScoreInput>({
          sameIndustry,
          adjacencyValue: sameIndustry
            ? undefined
            : this.industriesAreAdjacent(viewerIndustry, candidate.industryId)
              ? 0.45
              : 0.15,
        }),
      );
    }

    const viewerIntentRefs: IntentRef[] = viewerIntentRows.map((i) =>
      omitUndefined<IntentRef>({
        type: i.type,
        isPrimary: i.isPrimary,
        detail: i.detail ?? undefined,
      }),
    );
    if (viewerIntentRefs.length > 0 && candidate.intents.length > 0) {
      subScores.intent = intentScore(viewerIntentRefs, candidate.intents);
    }

    const toLanguageEntry = (
      rows: { code: string; proficiency: string | null }[],
    ): LanguageEntry[] =>
      rows
        .filter((r): r is { code: string; proficiency: string } => r.proficiency !== null)
        .map((r) => ({
          code: r.code,
          // Schema vocabulary ("fluent") doesn't match packages/matching's
          // ("professional") — closest semantic mapping, flagged as an
          // assumption reconciling two independently-built vocabularies.
          proficiency:
            r.proficiency === "fluent"
              ? "professional"
              : (r.proficiency as LanguageEntry["proficiency"]),
        }));
    const viewerLangs = toLanguageEntry(
      viewerLanguageRows.map((r) => ({ code: r.languageCode, proficiency: r.proficiency })),
    );
    const candidateLangs = toLanguageEntry(candidate.languages);
    if (viewerLangs.length > 0 && candidateLangs.length > 0) {
      subScores.lang = languagesScore(viewerLangs, candidateLangs);
    }

    const { score } = computeScore(subScores, 1, DEFAULT_WEIGHTS);

    const sharedSkills = candidate.skills.filter((s) =>
      viewerSkillRows.some((v) => v.name.toLowerCase() === s.toLowerCase()),
    );
    const reasons = generateReasons(
      subScores,
      omitUndefined<ReasonContext>({
        viewerPrimaryIntentType: viewerIntentRefs.find((i) => i.isPrimary)?.type,
        candidateFirstName: candidate.candidateFirstName,
        candidatePrimaryIntentType: candidate.intents.find((i) => i.isPrimary)?.type,
        candidateAvailabilityState: candidate.availabilityState,
        sharedSkillCount: sharedSkills.length,
        topSharedSkill: sharedSkills[0],
        mutualCount: candidate.mutualCount,
        sameIndustry:
          viewer.profile.industryId !== null && viewer.profile.industryId === candidate.industryId,
        candidateIndustryLabel: candidateIndustry?.name,
      }),
      3,
      DEFAULT_WEIGHTS,
    );

    return { score, reasons };
  }

  private industriesAreAdjacent(
    viewerIndustry: { adjacentIndustryIds: number[] } | null,
    candidateIndustryId: number,
  ): boolean {
    return viewerIndustry?.adjacentIndustryIds.includes(candidateIndustryId) ?? false;
  }
}
