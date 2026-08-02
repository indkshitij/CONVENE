import { describe, expect, it } from "vitest";
import { ANANYA_MEERA_REASON_CONTEXT, ANANYA_MEERA_SUB_SCORES } from "./__fixtures__/ananya-meera";
import { type ReasonContext, generateReasons } from "./reasons";
import type { SubScores } from "./score";

const BASE_CTX: ReasonContext = {
  candidateFirstName: "Meera",
  candidateAvailabilityState: "busy",
};

describe("generateReasons", () => {
  // PRD §11.6's own top-3 reasons for this pair don't literally match a
  // straight contribution-sort over the generic §11.10 templates (see
  // __fixtures__/ananya-meera.ts's own comment) — s_avail (0.143) and
  // s_skill (0.0696) both out-rank s_exp (0.036) and s_mutual (0.0315) by
  // raw contribution, yet the worked example's prose doesn't mention
  // availability or skills at all among its top 3. This asserts what the
  // §11.10 mechanism, implemented faithfully, actually produces for this
  // fixture (intent's reason ranks highest by far, then industry, then
  // exp) rather than force-matching the specific hand-written prose.
  it("generates the top-3 reasons for the §11.6 fixture via the §11.10 contribution-ranking mechanism", () => {
    const reasons = generateReasons(ANANYA_MEERA_SUB_SCORES, ANANYA_MEERA_REASON_CONTEXT);
    expect(reasons).toEqual([
      "You're looking for a mentor — Meera is mentoring right now",
      "Both in Tech",
      "16 years in Tech",
    ]);
  });

  it("returns an empty array when every template returns null", () => {
    expect(generateReasons({ avail: 0.5 }, BASE_CTX)).toEqual([]);
  });

  it("stops at topN reasons even when more templates would match", () => {
    const reasons = generateReasons(ANANYA_MEERA_SUB_SCORES, ANANYA_MEERA_REASON_CONTEXT, 1);
    expect(reasons).toHaveLength(1);
  });

  it("ignores sub-score keys that have no reason template (e.g. interest, activity, lang)", () => {
    const reasons = generateReasons({ interest: 1, activity: 1, lang: 1 }, BASE_CTX);
    expect(reasons).toEqual([]);
  });

  it("treats an explicitly-undefined sub-score value as 0 when ranking by contribution", () => {
    // Bypasses exactOptionalPropertyTypes deliberately — this simulates a
    // runtime value that's undefined despite the type saying it won't be,
    // to exercise rankByContribution's own defensive `?? 0` fallback.
    const subScores = { mutual: undefined, rep: 1 } as unknown as SubScores;
    const reasons = generateReasons(subScores, {
      ...BASE_CTX,
      mutualCount: 5,
      candidateResponseRate: 0.9,
    });
    // mutual's contribution is 0 (undefined value), so rep ranks first
    // despite mutual technically being present as a key.
    expect(reasons).toEqual(["Replies to 90% of messages", "5 mutual connections"]);
  });

  describe("intentReason", () => {
    it("returns null when either side's primary intent type is missing", () => {
      expect(
        generateReasons({ intent: 1 }, { ...BASE_CTX, viewerPrimaryIntentType: "need_mentor" }),
      ).toEqual([]);
    });
  });

  describe("availabilityReason", () => {
    it("reports minutes left when available_now", () => {
      const reasons = generateReasons(
        { avail: 1 },
        { ...BASE_CTX, candidateAvailabilityState: "available_now", candidateMinutesLeft: 28 },
      );
      expect(reasons).toEqual(["Available right now — expires in 28 min"]);
    });

    it("returns null when available_now but minutesLeft is missing", () => {
      expect(
        generateReasons({ avail: 1 }, { ...BASE_CTX, candidateAvailabilityState: "available_now" }),
      ).toEqual([]);
    });

    it("reports the next window when scheduled and a human string is supplied", () => {
      const reasons = generateReasons(
        { avail: 1 },
        {
          ...BASE_CTX,
          candidateAvailabilityState: "scheduled",
          candidateNextWindowHuman: "Thu 6 PM",
        },
      );
      expect(reasons).toEqual(["Free Thu 6 PM"]);
    });

    it("returns null when neither branch has the data it needs", () => {
      expect(
        generateReasons({ avail: 1 }, { ...BASE_CTX, candidateAvailabilityState: "busy" }),
      ).toEqual([]);
    });
  });

  describe("locationReason", () => {
    it("returns the distance bucket for tier 0/1", () => {
      const reasons = generateReasons(
        { loc: 1 },
        { ...BASE_CTX, candidateLocationTier: 1, candidateDistanceBucket: "~5 km away" },
      );
      expect(reasons).toEqual(["~5 km away"]);
    });

    it("returns the city for tier 2", () => {
      const reasons = generateReasons(
        { loc: 1 },
        { ...BASE_CTX, candidateLocationTier: 2, candidateCity: "Bengaluru" },
      );
      expect(reasons).toEqual(["Also in Bengaluru"]);
    });

    it("returns null for tier 3+", () => {
      expect(generateReasons({ loc: 1 }, { ...BASE_CTX, candidateLocationTier: 3 })).toEqual([]);
    });

    it("returns null when locationTier is missing entirely", () => {
      expect(generateReasons({ loc: 1 }, BASE_CTX)).toEqual([]);
    });

    it("returns null for tier 0/1 when distanceBucket is missing", () => {
      expect(generateReasons({ loc: 1 }, { ...BASE_CTX, candidateLocationTier: 0 })).toEqual([]);
    });

    it("returns null for tier 2 when city is missing", () => {
      expect(generateReasons({ loc: 1 }, { ...BASE_CTX, candidateLocationTier: 2 })).toEqual([]);
    });
  });

  describe("skillReason", () => {
    it("returns null below 2 shared skills", () => {
      expect(
        generateReasons(
          { skill: 1 },
          { ...BASE_CTX, sharedSkillCount: 1, topSharedSkill: "Python" },
        ),
      ).toEqual([]);
    });

    it("returns null when sharedSkillCount is missing entirely", () => {
      expect(generateReasons({ skill: 1 }, { ...BASE_CTX, topSharedSkill: "Python" })).toEqual([]);
    });

    it("returns null at 2+ shared skills when topSharedSkill is missing", () => {
      expect(generateReasons({ skill: 1 }, { ...BASE_CTX, sharedSkillCount: 3 })).toEqual([]);
    });

    it("returns the count and top skill at 2 or more", () => {
      const reasons = generateReasons(
        { skill: 1 },
        { ...BASE_CTX, sharedSkillCount: 3, topSharedSkill: "Python" },
      );
      expect(reasons).toEqual(["3 shared skills including Python"]);
    });
  });

  describe("mutualReason", () => {
    it("pluralises for more than 1 mutual connection", () => {
      expect(generateReasons({ mutual: 1 }, { ...BASE_CTX, mutualCount: 2 })).toEqual([
        "2 mutual connections",
      ]);
    });

    it("does not pluralise for exactly 1", () => {
      expect(generateReasons({ mutual: 1 }, { ...BASE_CTX, mutualCount: 1 })).toEqual([
        "1 mutual connection",
      ]);
    });

    it("returns null for 0 mutual connections", () => {
      expect(generateReasons({ mutual: 1 }, { ...BASE_CTX, mutualCount: 0 })).toEqual([]);
    });
  });

  describe("expReason", () => {
    it("returns null when not notable", () => {
      expect(
        generateReasons(
          { exp: 1 },
          {
            ...BASE_CTX,
            expNotable: false,
            candidateYearsExperience: 16,
            candidateIndustryLabel: "Tech",
          },
        ),
      ).toEqual([]);
    });
  });

  describe("industryReason", () => {
    it("returns null when industries differ", () => {
      expect(
        generateReasons(
          { industry: 1 },
          { ...BASE_CTX, sameIndustry: false, candidateIndustryLabel: "Tech" },
        ),
      ).toEqual([]);
    });
  });

  describe("repReason", () => {
    it("reports the response rate at or above 0.7", () => {
      const reasons = generateReasons({ rep: 1 }, { ...BASE_CTX, candidateResponseRate: 0.85 });
      expect(reasons).toEqual(["Replies to 85% of messages"]);
    });

    it("returns null below 0.7", () => {
      expect(generateReasons({ rep: 1 }, { ...BASE_CTX, candidateResponseRate: 0.5 })).toEqual([]);
    });

    it("returns null when responseRate is missing", () => {
      expect(generateReasons({ rep: 1 }, BASE_CTX)).toEqual([]);
    });
  });
});
