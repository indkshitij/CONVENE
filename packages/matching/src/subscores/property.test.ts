import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Clock } from "../types";
import { activityScore } from "./activity";
import { availabilityScore } from "./availability";
import { experienceScore } from "./experience";
import { industryScore } from "./industry";
import { intentScore } from "./intent";
import { interestsScore } from "./interests";
import { languagesScore } from "./languages";
import { locationScore } from "./location";
import { mutualScore } from "./mutual";
import { reputationScore } from "./reputation";
import { cofounderComplementarity, skillsScore } from "./skills";

const NOW = new Date("2026-08-02T12:00:00Z");
const fixedClock: Clock = { now: () => NOW };

const unit = fc.double({ min: 0, max: 1, noNaN: true });
const skillList = fc.array(fc.string({ minLength: 1, maxLength: 10 }), { maxLength: 15 });

// P4.2 acceptance: "Property tests: every sub-score returns [0,1] for
// arbitrary valid input."
describe("sub-score range property: every score is in [0, 1]", () => {
  it("activityScore", () => {
    fc.assert(
      fc.property(fc.nat(100), fc.nat(100), (days, sessions) => {
        const score = activityScore({
          activeDaysLast14: days,
          availabilitySessionsLast14: sessions,
        });
        return score >= 0 && score <= 1;
      }),
    );
  });

  it("mutualScore", () => {
    fc.assert(
      fc.property(fc.nat(1000), (count) => {
        const score = mutualScore(count);
        return score >= 0 && score <= 1;
      }),
    );
  });

  it("reputationScore", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (rep) => {
        const score = reputationScore(rep);
        return score >= 0 && score <= 1;
      }),
    );
  });

  it("interestsScore", () => {
    fc.assert(
      fc.property(
        skillList,
        skillList,
        unit,
        (viewerInterests, candidateInterests, cosineSimilarity) => {
          const score = interestsScore({ viewerInterests, candidateInterests, cosineSimilarity });
          return score >= 0 && score <= 1;
        },
      ),
    );
  });

  it("languagesScore", () => {
    const proficiency = fc.constantFrom(
      "native",
      "professional",
      "conversational",
      "basic",
    ) as fc.Arbitrary<"native" | "professional" | "conversational" | "basic">;
    const languageEntry = fc.record({
      code: fc.string({ minLength: 1, maxLength: 3 }),
      proficiency,
    });
    fc.assert(
      fc.property(
        fc.array(languageEntry, { maxLength: 8 }),
        fc.array(languageEntry, { maxLength: 8 }),
        (v, c) => {
          const score = languagesScore(v, c);
          return score >= 0 && score <= 1;
        },
      ),
    );
  });

  it("industryScore", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        unit,
        fc.boolean(),
        (sameIndustry, adjacencyValue, isHiringOrJobIntentFamily) => {
          const score = industryScore(
            sameIndustry
              ? { sameIndustry: true }
              : { sameIndustry: false, adjacencyValue, isHiringOrJobIntentFamily },
          );
          return score >= 0 && score <= 1;
        },
      ),
    );
  });

  it("cofounderComplementarity", () => {
    const areas = fc.constantFrom(
      "engineering",
      "data_ml",
      "design",
      "product",
      "growth_marketing",
      "sales_bd",
      "finance",
      "ops",
      "legal",
    );
    fc.assert(
      fc.property(
        unit,
        fc.array(areas, { maxLength: 9 }),
        fc.array(areas, { maxLength: 9 }),
        (domainOverlap, viewerAreas, candidateAreas) => {
          const score = cofounderComplementarity({
            domainOverlap,
            viewerFunctionalAreas: viewerAreas,
            candidateFunctionalAreas: candidateAreas,
          });
          return score >= 0 && score <= 1;
        },
      ),
    );
  });

  it("skillsScore (mentorship/learning/ai_collaboration/peer families)", () => {
    const family = fc.constantFrom(
      "mentorship_seeking",
      "mentorship_offering",
      "learning",
      "ai_collaboration",
      "peer",
    );
    fc.assert(
      fc.property(
        family,
        skillList,
        skillList,
        unit,
        (intentFamily, viewerSkills, candidateSkills, semanticSimilarity) => {
          const score = skillsScore({
            intentFamily: intentFamily as "mentorship_seeking",
            viewerSkills,
            candidateSkills,
            semanticSimilarity,
          });
          return score >= 0 && score <= 1;
        },
      ),
    );
  });

  it("experienceScore (non-hiring families)", () => {
    const family = fc.constantFrom(
      "mentorship_seeking",
      "mentorship_offering",
      "cofounder",
      "peer",
      "ai_collaboration",
      "learning",
    );
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 60, noNaN: true }),
        fc.double({ min: 0, max: 60, noNaN: true }),
        family,
        (viewerYears, candidateYears, intentFamily) => {
          const score = experienceScore({
            viewerYearsExperience: viewerYears,
            candidateYearsExperience: candidateYears,
            intentFamily: intentFamily as "peer",
          });
          return score >= 0 && score <= 1;
        },
      ),
    );
  });

  it("locationScore", () => {
    const tier = fc.constantFrom(0, 1, 2, 3, 4, 5, 6);
    const remotePref = fc.constantFrom("onsite", "hybrid", "remote", "any");
    fc.assert(
      fc.property(
        tier,
        unit,
        fc.boolean(),
        remotePref,
        (t, ratio, isHidden, viewerRemotePreference) => {
          const score = locationScore({
            tier: t as 0,
            tier1DistanceRatio: ratio,
            isHiddenLocation: isHidden,
            viewerRemotePreference: viewerRemotePreference as "hybrid",
          });
          return score >= 0 && score <= 1;
        },
      ),
    );
  });

  it("availabilityScore (available_now)", () => {
    fc.assert(
      fc.property(fc.integer({ min: -120, max: 500 }), (remainingMinutes) => {
        const score = availabilityScore(
          {
            state: "available_now",
            expiresAt: new Date(NOW.getTime() + remainingMinutes * 60_000),
          },
          fixedClock,
        );
        return score >= 0 && score <= 1;
      }),
    );
  });

  it("availabilityScore (offline)", () => {
    fc.assert(
      fc.property(fc.nat(2000), (hoursAgo) => {
        const score = availabilityScore(
          { state: "offline", lastSeenAt: new Date(NOW.getTime() - hoursAgo * 3_600_000) },
          fixedClock,
        );
        return score >= 0 && score <= 1;
      }),
    );
  });

  it("intentScore", () => {
    const intentType = fc.constantFrom(
      "looking_for_job",
      "hiring",
      "need_cofounder",
      "need_mentor",
      "need_mentee",
      "internship",
      "freelancer",
      "startup_discussion",
      "ai_collaboration",
      "business_networking",
      "coffee_chat",
      "learning",
      "investment_discussion",
      "partnerships",
    );
    const intentRef = fc.record({ type: intentType, isPrimary: fc.boolean() });
    fc.assert(
      fc.property(
        fc.array(intentRef, { minLength: 0, maxLength: 6 }),
        fc.array(intentRef, { minLength: 0, maxLength: 6 }),
        unit,
        (viewerIntents, candidateIntents, cofounderComplementarityScore) => {
          const score = intentScore(
            viewerIntents as { type: "hiring"; isPrimary: boolean }[],
            candidateIntents as { type: "hiring"; isPrimary: boolean }[],
            { cofounderComplementarityScore },
          );
          return score >= 0 && score <= 1;
        },
      ),
    );
  });

  it("expect() smoke check so this file always has at least one assertion call", () => {
    expect(true).toBe(true);
  });
});
