import {
  cofounderComplementarity,
  computeScore,
  experienceScore,
  industryScore,
  interestsScore,
  languagesScore,
  mutualScore,
  resolveIntentFamily,
  skillsScore,
  type FunctionalArea,
  type IntentRef,
  type SubScores,
} from "@convene/matching";
import { Injectable } from "@nestjs/common";
import { cosineSimilarity } from "../../profile/embedding-vector";
import { MatchingDataRepository } from "../repositories/matching-data.repository";

export interface StaticComponents {
  skill: number;
  industry: number;
  exp: number;
  interest: number;
  mutual: number;
  lang: number;
}

export interface StaticComponentsResult {
  components: StaticComponents;
  /** Weighted sum over just these six sub-scores, renormalised — an
   * ordering signal for match_candidates.static_score, not the final
   * compatibility score (which also needs the live sub-scores). */
  staticScore: number;
}

// PRD §11.7 O2: "Compute slow sub-scores: skill, interest, industry, exp,
// mutual, lang." Every one of these needs data that either barely changes
// (skills, industry, years of experience, languages) or is itself already
// a slow aggregate (mutual connection count) — exactly the PRD's own
// rationale for precomputing them hourly rather than per-request. Called
// both by the offline worker (match-precompute.service.ts) and, as a
// cold-start fallback, by the online path (matching.service.ts) when no
// precomputed row exists yet for a pair — the SAME function either way, so
// "precompute is a pure optimisation, never a behaviour change" holds by
// construction rather than by two independent implementations agreeing.
@Injectable()
export class StaticComponentsService {
  constructor(private readonly dataRepository: MatchingDataRepository) {}

  async compute(viewerId: string, candidateId: string): Promise<StaticComponentsResult> {
    const [
      profileFields,
      skillBundles,
      interestsByUser,
      languagesByUser,
      profileEmbeddings,
      viewerIntents,
      candidateIntents,
      mutualConnectionCount,
    ] = await Promise.all([
      this.dataRepository.loadProfileScoringFields([viewerId, candidateId]),
      this.dataRepository.loadSkillBundles([viewerId, candidateId]),
      this.dataRepository.loadInterests([viewerId, candidateId]),
      this.dataRepository.loadLanguages([viewerId, candidateId]),
      this.dataRepository.loadProfileEmbeddings([viewerId, candidateId]),
      this.loadViewerIntents(viewerId),
      this.loadViewerIntents(candidateId),
      this.dataRepository.loadMutualConnectionCount(viewerId, candidateId),
    ]);

    const viewerProfile = profileFields.get(viewerId);
    const candidateProfile = profileFields.get(candidateId);
    const viewerSkills = skillBundles.get(viewerId) ?? {
      names: [],
      functionalAreas: [],
      meanEmbedding: null,
    };
    const candidateSkills = skillBundles.get(candidateId) ?? {
      names: [],
      functionalAreas: [],
      meanEmbedding: null,
    };

    const intentFamily = resolveIntentFamily(viewerIntents, candidateIntents);

    const semanticSimilarity = this.similarity(
      viewerSkills.meanEmbedding ?? profileEmbeddings.get(viewerId) ?? null,
      candidateSkills.meanEmbedding ?? profileEmbeddings.get(candidateId) ?? null,
    );

    const { sameIndustry, adjacencyValue, domainOverlap } =
      await this.dataRepository.loadIndustryAdjacency(
        viewerProfile?.industryId ?? null,
        candidateProfile?.industryId ?? null,
      );

    const hiringIntentMetadata =
      intentFamily === "hiring"
        ? await this.dataRepository.loadIntentMetadata(viewerId)
        : undefined;

    const cofounderComplementarityScore =
      intentFamily === "cofounder"
        ? cofounderComplementarity({
            domainOverlap,
            viewerFunctionalAreas: viewerSkills.functionalAreas as FunctionalArea[],
            candidateFunctionalAreas: candidateSkills.functionalAreas as FunctionalArea[],
          })
        : undefined;

    const skill = skillsScore({
      intentFamily,
      viewerSkills: viewerSkills.names,
      candidateSkills: candidateSkills.names,
      semanticSimilarity,
      ...(hiringIntentMetadata?.requiredSkills
        ? { requiredSkills: hiringIntentMetadata.requiredSkills }
        : {}),
      ...(cofounderComplementarityScore !== undefined ? { cofounderComplementarityScore } : {}),
    });

    const industry = industryScore({
      sameIndustry,
      ...(sameIndustry ? {} : { adjacencyValue }),
      isHiringOrJobIntentFamily: intentFamily === "hiring",
    });

    // experienceScore's "hiring" branch throws without a seniorityRange —
    // fall back to the peer bucket when the viewer's hiring intent didn't
    // set one, rather than letting a missing optional metadata field crash
    // scoring for this whole pair.
    const seniorityRange = hiringIntentMetadata?.seniorityRange;
    const experienceFamily = intentFamily === "hiring" && !seniorityRange ? "peer" : intentFamily;
    const exp = experienceScore({
      viewerYearsExperience: viewerProfile?.yearsExperience ?? 0,
      candidateYearsExperience: candidateProfile?.yearsExperience ?? 0,
      intentFamily: experienceFamily,
      ...(seniorityRange ? { seniorityRange } : {}),
    });

    const interest = interestsScore({
      viewerInterests: interestsByUser.get(viewerId) ?? [],
      candidateInterests: interestsByUser.get(candidateId) ?? [],
      cosineSimilarity: this.similarity(
        profileEmbeddings.get(viewerId) ?? null,
        profileEmbeddings.get(candidateId) ?? null,
      ),
    });

    const mutual = mutualScore(mutualConnectionCount);

    const lang = languagesScore(
      languagesByUser.get(viewerId) ?? [],
      languagesByUser.get(candidateId) ?? [],
    );

    const components: StaticComponents = { skill, industry, exp, interest, mutual, lang };
    const { weightedSum } = computeScore(components as SubScores, 1);

    return { components, staticScore: weightedSum };
  }

  private similarity(a: number[] | null, b: number[] | null): number {
    if (!a || !b) return 0;
    return cosineSimilarity(a, b);
  }

  private async loadViewerIntents(userId: string): Promise<IntentRef[]> {
    const availability = await this.dataRepository.loadAvailabilityLive([userId]);
    const sessionIntentIds = availability.get(userId)?.intentIds ?? null;
    return this.dataRepository.loadIntentRefs(userId, sessionIntentIds);
  }
}
