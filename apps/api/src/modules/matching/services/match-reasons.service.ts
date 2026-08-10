import {
  bucketDistanceKm,
  generateReasons,
  type IntentType,
  type ReasonContext,
} from "@convene/matching";
import { Injectable } from "@nestjs/common";
import { MatchingDataRepository } from "../repositories/matching-data.repository";
import { MatchingWeightsProvider } from "./matching-weights-provider";
import type { ScoredCandidate } from "./matching.service";

const EXP_NOTABLE_THRESHOLD_YEARS = 5;

// PRD §11.10's generate_reasons() step + §14.8's card anatomy ("up to 3
// match-reason chips" — "the most important component in the product").
// Deliberately separate from MatchingService: scoring must never depend
// on display-only facts (skill names, city labels, response rate), and
// reason generation is only ever needed for the page actually rendered
// (≤20 cards), not every candidate scored.
@Injectable()
export class MatchReasonsService {
  constructor(
    private readonly dataRepository: MatchingDataRepository,
    private readonly weightsProvider: MatchingWeightsProvider,
  ) {}

  async generateReasonsForPage(
    viewerId: string,
    matches: readonly ScoredCandidate[],
  ): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (matches.length === 0) return result;
    const candidateIds = matches.map((m) => m.candidateId);

    const [
      viewerIntents,
      candidateIntentsByUser,
      displayFacts,
      skillBundles,
      mutualCounts,
      candidateAvailability,
      profileFields,
      weights,
    ] = await Promise.all([
      this.dataRepository.loadIntentRefs(viewerId),
      this.dataRepository.loadIntentRefsForUsers(candidateIds, new Map()),
      this.dataRepository.loadDisplayFacts(candidateIds),
      this.dataRepository.loadSkillBundles([viewerId, ...candidateIds]),
      this.dataRepository.loadMutualConnectionCounts(viewerId, candidateIds),
      this.dataRepository.loadAvailabilityLive(candidateIds),
      this.dataRepository.loadProfileScoringFields([viewerId, ...candidateIds]),
      this.weightsProvider.getActiveWeights(),
    ]);

    const viewerPrimaryIntentType = viewerIntents.find((intent) => intent.isPrimary)?.type;
    const viewerSkills = new Set(
      (skillBundles.get(viewerId)?.names ?? []).map((name) => name.toLowerCase()),
    );
    const viewerProfile = profileFields.get(viewerId);

    for (const match of matches) {
      const candidateId = match.candidateId;
      const facts = displayFacts.get(candidateId);
      const candidateSkills = skillBundles.get(candidateId)?.names ?? [];
      const sharedSkills = candidateSkills.filter((name) => viewerSkills.has(name.toLowerCase()));
      const live = candidateAvailability.get(candidateId);
      const candidateProfile = profileFields.get(candidateId);
      const primaryIntent = candidateIntentsByUser
        .get(candidateId)
        ?.find((intent) => intent.isPrimary)?.type as IntentType | undefined;
      const minutesLeft =
        live?.state === "available_now" && live.expiresAt
          ? Math.max(0, Math.round((live.expiresAt.getTime() - Date.now()) / 60_000))
          : undefined;
      const expNotable =
        viewerProfile && candidateProfile
          ? Math.abs(candidateProfile.yearsExperience - viewerProfile.yearsExperience) >=
            EXP_NOTABLE_THRESHOLD_YEARS
          : false;
      const sameIndustry = Boolean(
        viewerProfile?.industryId != null &&
        candidateProfile?.industryId != null &&
        viewerProfile.industryId === candidateProfile.industryId,
      );

      const ctx: ReasonContext = {
        ...(viewerPrimaryIntentType ? { viewerPrimaryIntentType } : {}),
        candidateFirstName: facts?.firstName ?? "They",
        ...(primaryIntent ? { candidatePrimaryIntentType: primaryIntent } : {}),
        candidateAvailabilityState: live?.state ?? "offline",
        ...(minutesLeft !== undefined ? { candidateMinutesLeft: minutesLeft } : {}),
        ...(match.distanceM !== null
          ? {
              candidateDistanceBucket: bucketDistanceKm(
                match.distanceM / 1000,
                match.locationTier <= 4,
              ),
            }
          : {}),
        candidateLocationTier: match.locationTier,
        ...(facts?.cityName ? { candidateCity: facts.cityName } : {}),
        sharedSkillCount: sharedSkills.length,
        ...(sharedSkills[0] ? { topSharedSkill: sharedSkills[0] } : {}),
        mutualCount: mutualCounts.get(candidateId) ?? 0,
        ...(candidateProfile ? { candidateYearsExperience: candidateProfile.yearsExperience } : {}),
        ...(facts?.industryName ? { candidateIndustryLabel: facts.industryName } : {}),
        expNotable,
        sameIndustry,
        ...(facts?.responseRate !== null && facts?.responseRate !== undefined
          ? { candidateResponseRate: facts.responseRate }
          : {}),
      };

      result.set(candidateId, generateReasons(match.components, ctx, 3, weights));
    }

    return result;
  }
}
