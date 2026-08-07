import {
  education,
  experiences,
  identityVerifications,
  media,
  profiles,
  userInterests,
  userIntents,
  userLanguages,
  userSkills,
  users,
} from "@convene/db";
import { Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { NotFoundAppError } from "../../common/errors/app-error";
import { PostgresService } from "../../infra/postgres/postgres.service";
import {
  type CompletionFacts,
  type CompletionResult,
  computeProfileCompletion,
} from "./completion";
import { deriveVerificationLevel } from "./verification-ladder";

function isValidTimezone(tz: string | null): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// PRD §10.2.9 endpoint 17 (§10.2.4 for the formula itself). Gathers the
// twelve components' raw facts from the DB and delegates scoring to the
// pure computeProfileCompletion function (completion.ts) so the formula
// itself stays independently unit-testable without a database.
@Injectable()
export class CompletionService {
  constructor(private readonly postgres: PostgresService) {}

  // Recomputes and persists profiles.profile_completion — the column
  // idx_prof_discoverable/idx_prof_city key off — so it never drifts from
  // what this endpoint reports. Called on every read of GET
  // /profiles/me/completion; write-path recompute-on-mutation (profile
  // update, children CRUD, verification changes) is deferred to whichever
  // phase first reads profile_completion for a live query (Phase 13
  // discovery), consistent with not building ahead of an actual consumer.
  async getCompletion(userId: string): Promise<CompletionResult> {
    const facts = await this.gatherFacts(userId);
    const result = computeProfileCompletion(facts);
    await this.postgres.db
      .update(profiles)
      .set({ profileCompletion: result.score })
      .where(eq(profiles.userId, userId));
    return result;
  }

  private async gatherFacts(userId: string): Promise<CompletionFacts> {
    const [row] = await this.postgres.db
      .select({ user: users, profile: profiles })
      .from(users)
      .innerJoin(profiles, eq(profiles.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) throw new NotFoundAppError("PROFILE_NOT_FOUND", "This profile isn't available");
    const { user, profile } = row;

    const [
      avatarRow,
      skillRows,
      experienceRows,
      educationRows,
      interestRows,
      languageRows,
      activeIntentRows,
      latestIdentity,
    ] = await Promise.all([
      profile.avatarMediaId
        ? this.postgres.db
            .select()
            .from(media)
            .where(eq(media.id, profile.avatarMediaId))
            .limit(1)
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
      this.postgres.db.select().from(userSkills).where(eq(userSkills.userId, userId)),
      this.postgres.db.select().from(experiences).where(eq(experiences.userId, userId)),
      this.postgres.db.select().from(education).where(eq(education.userId, userId)),
      this.postgres.db.select().from(userInterests).where(eq(userInterests.userId, userId)),
      this.postgres.db.select().from(userLanguages).where(eq(userLanguages.userId, userId)),
      this.postgres.db
        .select()
        .from(userIntents)
        .where(and(eq(userIntents.userId, userId), eq(userIntents.status, "active"))),
      this.postgres.db
        .select()
        .from(identityVerifications)
        .where(eq(identityVerifications.userId, userId))
        .orderBy(desc(identityVerifications.createdAt))
        .limit(1)
        .then((r) => r[0] ?? null),
    ]);

    // Derived fresh from persisted signals (users.*_verified_at,
    // profiles.company_verified, the latest identity_verifications row)
    // rather than trusted from the cached profiles.verification_level
    // column — that column is only written by
    // VerificationLadderService's own L3/L4 mutation paths, so an L1/L2
    // change (email/phone verified at registration or login) wouldn't be
    // reflected there until an unrelated L3/L4 action happened to trigger
    // a recompute. Both services share deriveVerificationLevel so they
    // can never disagree on what a given set of signals means.
    const verificationLevel = deriveVerificationLevel({
      emailVerified: user.emailVerifiedAt !== null,
      phoneVerified: user.phoneVerifiedAt !== null,
      workEmailVerified: profile.companyVerified,
      governmentIdApproved: latestIdentity?.result === "approved",
    });

    return {
      fullNamePresent: user.fullName.trim().length > 0,
      avatarPresent: profile.avatarMediaId !== null,
      avatarModerationPassed: avatarRow?.moderationState === "clean",
      headlineLength: profile.headline?.length ?? 0,
      aboutLength: profile.about?.length ?? 0,
      hasIndustry: profile.industryId !== null,
      hasJobTitle: profile.jobTitle !== null && profile.jobTitle.length > 0,
      hasCompany: profile.companyName !== null && profile.companyName.length > 0,
      skillsCount: skillRows.length,
      experienceDescriptionLengths: experienceRows.map((e) => e.description?.length ?? 0),
      educationCount: educationRows.length,
      interestsCount: interestRows.length,
      languagesCount: languageRows.length,
      hasCity: profile.cityId !== null,
      hasValidTimezone: isValidTimezone(profile.timezone),
      verificationLevel,
      activeIntentsCount: activeIntentRows.length,
    };
  }
}
