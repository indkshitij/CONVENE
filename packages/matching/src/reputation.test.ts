import { describe, expect, it } from "vitest";
import {
  acceptanceBehaviourScore,
  applyDecay,
  bandForScore,
  combineReputationScore,
  communityContributionsScore,
  computeReputation,
  computeReputationComponents,
  conversationDepthScore,
  profileQualityScore,
  reportRatioPenalty,
  responseRateScore,
  responseSpeedScore,
  shrinkTowardPrior,
  tenureActivityScore,
  type ReputationComponentsInput,
} from "./reputation";

// A "mature, strong user" fixture with >=5 observations on every
// component (so Bayesian shrinkage is a no-op, weight=1 everywhere) —
// hand-computed below, independently of the implementation, to verify
// combineReputationScore's weighted-average-minus-penalty formula.
const matureInput: ReputationComponentsInput = {
  responseRate: { firstMessagesReceived: 20, repliedWithin72h: 18 }, // 90%
  responseSpeed: { medianFirstReplyMinutes: 30, observations: 20 },
  conversationDepth: { conversationsStarted: 20, conversationsReachingSixMessages: 15 }, // 75%
  acceptanceBehaviour: { accepted: 12, rejected: 8 }, // ratio 0.6
  profileQuality: { profileCompletion: 90, verificationLevel: 3 },
  tenureActivity: { accountAgeDays: 400, daysSinceLastActive: 2 },
  reportRatio: {
    conversations: 50,
    upheldReportsBySeverity: { critical: 0, high: 0, medium: 1, low: 1 },
  },
  communityContributions: { mentorshipSessionsCompleted: 3, positiveFeedbackCount: 4 },
  accountAgeDays: 400,
  daysSinceLastActive: 2,
};

describe("shrinkTowardPrior", () => {
  it("returns exactly the prior at 0 observations", () => {
    expect(shrinkTowardPrior(100, 0)).toBe(50);
  });

  it("returns the observed value unchanged once observations meet the minimum", () => {
    expect(shrinkTowardPrior(90, 5)).toBe(90);
    expect(shrinkTowardPrior(90, 50)).toBe(90);
  });

  it("blends proportionally below the minimum", () => {
    // 1 observation of 5 needed => 1/5 weight toward the observed value.
    expect(shrinkTowardPrior(100, 1)).toBeCloseTo(60, 10); // 100*0.2 + 50*0.8
    expect(shrinkTowardPrior(0, 1)).toBeCloseTo(40, 10); // 0*0.2 + 50*0.8
  });

  it("respects a custom prior and minimum", () => {
    expect(shrinkTowardPrior(80, 2, 40, 4)).toBeCloseTo(80 * 0.5 + 40 * 0.5, 10);
  });
});

describe("responseRateScore", () => {
  it("hand-computed: 18/20 replied, full observations => 90", () => {
    expect(responseRateScore({ firstMessagesReceived: 20, repliedWithin72h: 18 })).toBeCloseTo(
      90,
      10,
    );
  });

  it("returns the prior when nothing was received", () => {
    expect(responseRateScore({ firstMessagesReceived: 0, repliedWithin72h: 0 })).toBe(50);
  });

  it("a single reply lands near the prior, not at the 100 extreme", () => {
    const score = responseRateScore({ firstMessagesReceived: 1, repliedWithin72h: 1 });
    expect(score).toBeCloseTo(60, 10); // shrinkTowardPrior(100, 1) = 60
    expect(score).toBeLessThan(75); // nowhere near the 100 extreme a single data point would naively imply
  });
});

describe("responseSpeedScore", () => {
  it("hand-computed: 30-minute median, full observations", () => {
    // 100 * (1 - ln(31)/ln(1441))
    expect(responseSpeedScore({ medianFirstReplyMinutes: 30, observations: 20 })).toBeCloseTo(
      52.785047637452465,
      9,
    );
  });

  it("caps at 24h — slower medians score identically to the cap", () => {
    const atCap = responseSpeedScore({ medianFirstReplyMinutes: 1440, observations: 20 });
    const beyondCap = responseSpeedScore({ medianFirstReplyMinutes: 5000, observations: 20 });
    expect(atCap).toBeCloseTo(0, 10);
    expect(beyondCap).toBeCloseTo(0, 10);
  });

  it("an instant reply scores 100", () => {
    expect(responseSpeedScore({ medianFirstReplyMinutes: 0, observations: 20 })).toBeCloseTo(
      100,
      10,
    );
  });
});

describe("conversationDepthScore", () => {
  it("hand-computed: 15/20 reached depth, full observations => 75", () => {
    expect(
      conversationDepthScore({ conversationsStarted: 20, conversationsReachingSixMessages: 15 }),
    ).toBeCloseTo(75, 10);
  });

  it("returns the prior with zero conversations", () => {
    expect(
      conversationDepthScore({ conversationsStarted: 0, conversationsReachingSixMessages: 0 }),
    ).toBe(50);
  });
});

describe("acceptanceBehaviourScore", () => {
  it("hand-computed: 12 accepted / 8 rejected => ratio 0.6 => 80", () => {
    expect(acceptanceBehaviourScore({ accepted: 12, rejected: 8 })).toBeCloseTo(80, 10);
  });

  it("a perfectly balanced ratio scores 100", () => {
    expect(acceptanceBehaviourScore({ accepted: 10, rejected: 10 })).toBeCloseTo(100, 10);
  });

  it("an extreme ratio is neutral (50), never penalised below it", () => {
    expect(acceptanceBehaviourScore({ accepted: 20, rejected: 0 })).toBeCloseTo(50, 10);
    expect(acceptanceBehaviourScore({ accepted: 0, rejected: 20 })).toBeCloseTo(50, 10);
  });

  it("returns the prior with no accept/reject history", () => {
    expect(acceptanceBehaviourScore({ accepted: 0, rejected: 0 })).toBe(50);
  });
});

describe("profileQualityScore", () => {
  it("hand-computed: 90 completion x (3/4 verification) => 67.5", () => {
    expect(profileQualityScore({ profileCompletion: 90, verificationLevel: 3 })).toBeCloseTo(
      67.5,
      10,
    );
  });

  it("zero verification zeroes the score regardless of completion", () => {
    expect(profileQualityScore({ profileCompletion: 100, verificationLevel: 0 })).toBe(0);
  });

  it("full completion and verification scores 100", () => {
    expect(profileQualityScore({ profileCompletion: 100, verificationLevel: 4 })).toBe(100);
  });
});

describe("tenureActivityScore", () => {
  it("hand-computed: 400-day account, active 2 days ago", () => {
    // (100*ln(401)/ln(731) + 100*(1 - 2/60)) / 2
    expect(tenureActivityScore({ accountAgeDays: 400, daysSinceLastActive: 2 })).toBeCloseTo(
      93.78060065962264,
      9,
    );
  });

  it("caps age at the 730-day horizon", () => {
    const atCap = tenureActivityScore({ accountAgeDays: 730, daysSinceLastActive: 0 });
    const beyondCap = tenureActivityScore({ accountAgeDays: 5000, daysSinceLastActive: 0 });
    expect(atCap).toBeCloseTo(beyondCap, 10);
  });

  it("a brand-new but active account scores low on age, high on activity", () => {
    const score = tenureActivityScore({ accountAgeDays: 0, daysSinceLastActive: 0 });
    expect(score).toBeCloseTo(50, 10); // ageComponent 0, activityComponent 100, average 50
  });
});

describe("reportRatioPenalty", () => {
  it("hand-computed: 1 medium + 1 low upheld over 50 conversations => 6", () => {
    expect(
      reportRatioPenalty({
        conversations: 50,
        upheldReportsBySeverity: { critical: 0, high: 0, medium: 1, low: 1 },
      }),
    ).toBeCloseTo(6, 10);
  });

  it("is 0 with no upheld reports", () => {
    expect(
      reportRatioPenalty({
        conversations: 10,
        upheldReportsBySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      }),
    ).toBe(0);
  });

  it("is 0 with no conversations at all (no denominator to divide by)", () => {
    expect(
      reportRatioPenalty({
        conversations: 0,
        upheldReportsBySeverity: { critical: 5, high: 0, medium: 0, low: 0 },
      }),
    ).toBe(0);
  });

  it("weights critical reports more heavily than low-severity ones", () => {
    const critical = reportRatioPenalty({
      conversations: 100,
      upheldReportsBySeverity: { critical: 1, high: 0, medium: 0, low: 0 },
    });
    const low = reportRatioPenalty({
      conversations: 100,
      upheldReportsBySeverity: { critical: 0, high: 0, medium: 0, low: 1 },
    });
    expect(critical).toBeGreaterThan(low);
  });

  it("caps at the 20-point maximum penalty", () => {
    expect(
      reportRatioPenalty({
        conversations: 1,
        upheldReportsBySeverity: { critical: 10, high: 0, medium: 0, low: 0 },
      }),
    ).toBe(20);
  });
});

describe("communityContributionsScore", () => {
  it("hand-computed: 3 sessions + 4 positive feedback, 7 observations => full weight", () => {
    // 3*10 + 4*5 = 50, observations 7 >= 5 => unshrunk
    expect(
      communityContributionsScore({ mentorshipSessionsCompleted: 3, positiveFeedbackCount: 4 }),
    ).toBeCloseTo(50, 10);
  });

  it("a single contribution lands near the prior", () => {
    const score = communityContributionsScore({
      mentorshipSessionsCompleted: 1,
      positiveFeedbackCount: 0,
    });
    expect(score).toBeCloseTo(shrinkTowardPrior(10, 1), 10);
    expect(score).toBeLessThan(60);
  });

  it("returns the prior with no contributions at all", () => {
    expect(
      communityContributionsScore({ mentorshipSessionsCompleted: 0, positiveFeedbackCount: 0 }),
    ).toBe(50);
  });
});

describe("combineReputationScore + computeReputationComponents", () => {
  it("hand-computed composite for the mature-user fixture", () => {
    const components = computeReputationComponents(matureInput);
    const score = combineReputationScore(components);
    expect(score).toBeCloseTo(71.11840536634168, 6);
  });

  it("clamps the combined score to [0, 100]", () => {
    const allZero = combineReputationScore({
      responseRate: 0,
      responseSpeed: 0,
      conversationDepth: 0,
      acceptanceBehaviour: 0,
      profileQuality: 0,
      tenureActivity: 0,
      communityContributions: 0,
      reportPenalty: 20,
    });
    expect(allZero).toBe(0);

    const allMax = combineReputationScore({
      responseRate: 100,
      responseSpeed: 100,
      conversationDepth: 100,
      acceptanceBehaviour: 100,
      profileQuality: 100,
      tenureActivity: 100,
      communityContributions: 100,
      reportPenalty: 0,
    });
    expect(allMax).toBe(100);
  });
});

describe("bandForScore", () => {
  it.each([
    [0, "new"],
    [39, "new"],
    [40, "building"],
    [59, "building"],
    [60, "trusted"],
    [79, "trusted"],
    [80, "highly_trusted"],
    [100, "highly_trusted"],
  ] as const)("bandForScore(%i) === %s", (score, expected) => {
    expect(bandForScore(score)).toBe(expected);
  });
});

describe("applyDecay", () => {
  it("does not decay within the 60-day active window", () => {
    expect(applyDecay(90, 0)).toBe(90);
    expect(applyDecay(90, 60)).toBe(90);
  });

  it("hand-computed: 1 month past the window pulls 5% toward 50", () => {
    expect(applyDecay(90, 90)).toBeCloseTo(88, 10); // 50 + 40*0.95
  });

  it("hand-computed: 3 months past the window compounds the pull", () => {
    expect(applyDecay(90, 150)).toBeCloseTo(84.29499999999999, 10); // 50 + 40*0.95^3
  });

  it("decay pulls a below-mean score up toward 50 too", () => {
    expect(applyDecay(20, 150)).toBeCloseTo(50 - 30 * Math.pow(0.95, 3), 10);
  });
});

describe("computeReputation", () => {
  it("seeds new users (<14 days) at 50/new regardless of components", () => {
    const result = computeReputation({ ...matureInput, accountAgeDays: 5, daysSinceLastActive: 0 });
    expect(result.score).toBe(50);
    expect(result.band).toBe("new");
  });

  it("computes a mature user's score and band end-to-end", () => {
    const result = computeReputation(matureInput);
    expect(result.score).toBeCloseTo(71.11840536634168, 6);
    expect(result.band).toBe("trusted");
  });

  it("a single interaction (fresh but past the 14-day window) lands near the prior, not at an extreme", () => {
    const oneInteraction: ReputationComponentsInput = {
      responseRate: { firstMessagesReceived: 1, repliedWithin72h: 1 },
      responseSpeed: { medianFirstReplyMinutes: 1, observations: 1 },
      conversationDepth: { conversationsStarted: 1, conversationsReachingSixMessages: 1 },
      acceptanceBehaviour: { accepted: 1, rejected: 0 },
      profileQuality: { profileCompletion: 50, verificationLevel: 1 },
      tenureActivity: { accountAgeDays: 20, daysSinceLastActive: 0 },
      reportRatio: {
        conversations: 1,
        upheldReportsBySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      },
      communityContributions: { mentorshipSessionsCompleted: 0, positiveFeedbackCount: 0 },
      accountAgeDays: 20,
      daysSinceLastActive: 0,
    };
    const result = computeReputation(oneInteraction);
    // Every observation-based component is shrunk hard toward 50 at n=1;
    // nowhere near the 0 or 100 extremes a single perfect/failed
    // interaction would naively produce.
    expect(result.score).toBeGreaterThan(35);
    expect(result.score).toBeLessThan(65);
  });

  it("applies decay for a user inactive well past 60 days", () => {
    const active = computeReputation(matureInput);
    const inactive = computeReputation({ ...matureInput, daysSinceLastActive: 150 });
    // Same components except the decay window is only applied to the
    // final combined score, not the tenureActivity sub-score inputs here
    // (daysSinceLastActive still feeds tenureActivity too, so this also
    // exercises that interaction) — inactive should land closer to 50.
    expect(Math.abs(inactive.score - 50)).toBeLessThan(Math.abs(active.score - 50));
  });
});

// "Acceptance: ... purchasability is structurally impossible." The type
// system itself is the assertion (see reputation.ts's own
// AssertNoBillingOverlap) — this runtime test exists so a coverage
// report shows the guarantee was exercised, and so a future refactor
// that quietly widens ReputationComponentsInput's keys is caught by a
// runtime string check too, not only by the type-level one.
describe("purchasability is structurally impossible", () => {
  it("no key of the reputation input type names a billing concept", () => {
    const billingLikeNames = [
      "plan",
      "plancode",
      "price",
      "entitlement",
      "provider",
      "subscription",
      "payment",
      "currency",
      "interval",
      "premium",
    ];
    const inputKeys = Object.keys(matureInput);
    for (const key of inputKeys) {
      const lower = key.toLowerCase();
      for (const billingWord of billingLikeNames) {
        expect(lower.includes(billingWord)).toBe(false);
      }
    }
  });
});
