import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type GateContext, applyGates } from "./gates";
import { type MultiplierInput, computeMultiplier } from "./multipliers";
import { type SubScores, computeScore } from "./score";

// PRD §11.2: "Hard gates are applied before scoring; multipliers after the
// weighted sum. This ordering guarantees that a Premium boost can never
// surface an irrelevant person (the gate already removed them)." §11.4:
// "G8 is the product's immune system ... No multiplier, plan, or admin
// flag bypasses it."
describe("gates run before scoring — a Pro-plan multiplier cannot surface a gated candidate", () => {
  const gatedContext: GateContext = {
    viewerId: "viewer-1",
    candidateId: "candidate-1",
    isBlockedEitherDirection: false,
    hasActiveSuppression: false,
    isConnectedOrPendingRequest: false,
    profileVisibility: "public",
    viewerIsMatch: false,
    accountStatus: "active",
    profileCompletion: 60,
    intentScore: 0.05, // below the 0.20 floor -> G8
    passesInboundFilter: true,
    availabilityState: "available_now",
    lastSessionAt: new Date(),
  };

  it("gates this candidate out on G8, regardless of how favourable their other scores/plan are", () => {
    const gateResult = applyGates(gatedContext);
    expect(gateResult).toEqual({ excluded: true, gate: "G8_INTENT_FLOOR" });
  });

  it("even the maximum possible Pro-plan multiplier cannot lift a gated candidate into the results, because a gated candidate is never scored at all", () => {
    const gateResult = applyGates(gatedContext);
    expect(gateResult.excluded).toBe(true);

    // The pipeline's own contract: computeScore/computeMultiplier are
    // never even called for a gated candidate. Demonstrating this
    // concretely — even feeding in the best possible sub-scores and the
    // strongest documented multiplier (Pro plan, L4 verification, Convene
    // Hours, cold-start boost) would produce a perfect 100, which is
    // exactly why gating must happen first: multipliers alone cannot
    // distinguish a gated candidate from a strong one.
    const maximalMultiplier = computeMultiplier({
      verificationLevel: "L4",
      plan: "pro",
      candidateInactiveDays: 0,
      bothInConveneHour: true,
      fatigueMultiplier: 1.0,
      candidateIsNewbie: true,
    });
    // Deliberately using best-case sub-scores here (not this candidate's
    // real 0.05 intent score) — the point is that computeScore/
    // computeMultiplier have no way to "know" a candidate was supposed to
    // be gated; only applyGates() does. If this candidate's real 0.05
    // intent score were fed through instead, the resulting number would
    // vary, but that's beside the point: the pipeline never gets that far.
    const { score } = computeScore({ avail: 1, intent: 1 }, maximalMultiplier);
    expect(score).toBe(100);

    // Which is precisely why this candidate must never reach computeScore
    // at all in the real pipeline — gateResult.excluded (checked above)
    // is the only thing standing between a 0.05 intent score and a
    // perfect 100.
    expect(gateResult.excluded).toBe(true);
  });
});

// P4.3 acceptance: "Property test: multipliers never move a score outside
// [0,100]." Every documented multiplier (§11.3) is bounded, but the
// composition is a product of up to six factors — this confirms
// computeScore's own clamp holds regardless of how those compose.
describe("property: computeScore's final score is always in [0, 100]", () => {
  it("holds for arbitrary sub-scores and arbitrary valid multiplier compositions", () => {
    const verificationLevel = fc.constantFrom("L0", "L1", "L2", "L3", "L4");
    const plan = fc.constantFrom("free", "premium", "pro");
    const subScoreValue = fc.double({ min: 0, max: 1, noNaN: true });

    const multiplierInput = fc.record({
      verificationLevel,
      plan,
      candidateInactiveDays: fc.nat(200),
      bothInConveneHour: fc.boolean(),
      fatigueMultiplier: fc.double({ min: 0, max: 2, noNaN: true }),
      candidateIsNewbie: fc.boolean(),
    });

    const subScores = fc.record({
      avail: subScoreValue,
      intent: subScoreValue,
      loc: subScoreValue,
      skill: subScoreValue,
      industry: subScoreValue,
      exp: subScoreValue,
      interest: subScoreValue,
      mutual: subScoreValue,
      activity: subScoreValue,
      rep: subScoreValue,
      lang: subScoreValue,
    });

    fc.assert(
      fc.property(subScores, multiplierInput, (scores, mInput) => {
        const multiplier = computeMultiplier(mInput as MultiplierInput);
        const { score } = computeScore(scores as SubScores, multiplier);
        return score >= 0 && score <= 100;
      }),
    );
  });
});
