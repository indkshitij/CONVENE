import { describe, expect, it } from "vitest";
import type { IntentRef } from "../types";
import { DEFAULT_COMPLEMENTARITY_MATRIX, intentScore } from "./intent";

function intent(type: IntentRef["type"], isPrimary = false, detail?: string): IntentRef {
  return detail === undefined ? { type, isPrimary } : { type, isPrimary, detail };
}

describe("intentScore", () => {
  it("returns 0.0 when the viewer has no intents", () => {
    expect(intentScore([], [intent("need_mentee")])).toBe(0.0);
  });

  it("returns 0.0 when the candidate has no intents", () => {
    expect(intentScore([intent("need_mentor")], [])).toBe(0.0);
  });

  it("returns the matrix weight for a single non-primary pair", () => {
    // looking_for_job -> hiring = 1.00 per §11.5.2's matrix
    const score = intentScore([intent("looking_for_job")], [intent("hiring")]);
    expect(score).toBeCloseTo(1.0, 5);
  });

  // PRD §11.6 worked example: Ananya (need_mentor, primary) ×
  // Meera (need_mentee, primary) -> 1.00, both primary, capped at 1.0.
  it("caps a both-primary pair at 1.0 (the §11.6 worked example)", () => {
    const score = intentScore([intent("need_mentor", true)], [intent("need_mentee", true)]);
    expect(score).toBeCloseTo(1.0, 5);
  });

  it("applies only the viewer's primary multiplier when only the viewer's intent is primary", () => {
    // need_mentor -> learning = 0.55. ×1.15 (viewer primary only) = 0.6325.
    const score = intentScore([intent("need_mentor", true)], [intent("learning", false)]);
    expect(score).toBeCloseTo(0.55 * 1.15, 5);
  });

  it("skips a pair whose matrix weight is 0 (a custom matrix, since the default has no zero entries)", () => {
    const customMatrix = {
      ...DEFAULT_COMPLEMENTARITY_MATRIX,
      looking_for_job: { ...DEFAULT_COMPLEMENTARITY_MATRIX.looking_for_job, hiring: 0 },
    };
    const score = intentScore([intent("looking_for_job")], [intent("hiring")], {
      matrix: customMatrix,
    });
    expect(score).toBe(0.0);
  });

  it("applies the semantic detail bonus when both sides supply detail text and a similarity function", () => {
    const withoutBonus = intentScore([intent("need_mentor")], [intent("need_mentee")]);
    const withBonus = intentScore(
      [intent("need_mentor", false, "payments ML")],
      [intent("need_mentee", false, "fintech mentoring")],
      { detailSimilarity: () => 0.8 },
    );
    // 1.00 × (1 + 0.15 × 0.8) = 1.12, capped to 1.0 — so use a lower-weight
    // pair to actually observe the bonus below the cap.
    expect(withBonus).toBeGreaterThanOrEqual(withoutBonus);

    const lowerWeight = intentScore([intent("need_mentor")], [intent("learning")]);
    const lowerWeightWithBonus = intentScore(
      [intent("need_mentor", false, "payments ML")],
      [intent("learning", false, "fintech mentoring")],
      { detailSimilarity: () => 0.8 },
    );
    expect(lowerWeightWithBonus).toBeCloseTo(lowerWeight * (1 + 0.15 * 0.8), 5);
  });

  it("applies no bonus (multiplier of 1) when detail text is present but no detailSimilarity is supplied", () => {
    const withDetailNoOption = intentScore(
      [intent("need_mentor", false, "payments ML")],
      [intent("learning", false, "fintech mentoring")],
    );
    const withoutDetail = intentScore([intent("need_mentor")], [intent("learning")]);
    expect(withDetailNoOption).toBeCloseTo(withoutDetail, 5);
  });

  it("does not apply the detail bonus when only one side has detail text", () => {
    const score = intentScore([intent("need_mentor", false, "payments ML")], [intent("learning")]);
    const baseline = intentScore([intent("need_mentor")], [intent("learning")]);
    expect(score).toBeCloseTo(baseline, 5);
  });

  it("applies the cofounder complementarity multiplier only for need_cofounder <-> need_cofounder pairs", () => {
    const score = intentScore([intent("need_cofounder")], [intent("need_cofounder")], {
      cofounderComplementarityScore: 0.5,
    });
    // matrix weight 1.00 × 0.5 = 0.5
    expect(score).toBeCloseTo(0.5, 5);
  });

  it("defaults the cofounder complementarity multiplier to 1 (neutral) when not supplied", () => {
    const score = intentScore([intent("need_cofounder")], [intent("need_cofounder")]);
    expect(score).toBeCloseTo(1.0, 5);
  });

  it("applies a multi-pair bonus when more than one pair matches", () => {
    const singlePair = intentScore([intent("need_mentor")], [intent("learning")]);
    const multiPair = intentScore(
      [intent("need_mentor"), intent("ai_collaboration")],
      [intent("learning")],
    );
    // need_mentor->learning = 0.55 (best); ai_collaboration->learning = 0.60 (actually higher!)
    // Use the higher one as "best" and confirm the multi bonus adds on top of it.
    const best = Math.max(0.55, 0.6);
    expect(multiPair).toBeCloseTo(Math.min(1.0, best + 0.05), 5);
    expect(multiPair).toBeGreaterThan(singlePair);
  });

  it("caps the multi-pair bonus at 0.15 regardless of how many pairs match", () => {
    const manyIntents = [
      intent("need_mentor"),
      intent("ai_collaboration"),
      intent("business_networking"),
      intent("coffee_chat"),
      intent("learning"),
    ];
    const score = intentScore(manyIntents, [intent("learning")]);
    // best pair among these -> learning: need_mentor .55, ai_collab .60,
    // business_networking .40, coffee_chat .55, learning(self) .85 (best).
    // 5 nonzero pairs -> multi = min(0.15, 0.05*4) = 0.15 exactly at the cap.
    expect(score).toBeCloseTo(Math.min(1.0, 0.85 + 0.15), 5);
  });

  it("applies count normalisation (1/sqrt(n/3)) once the candidate has more than 3 active intents", () => {
    // Zero out 3 of the 4 candidate-side weights against need_mentor so
    // only one pair ever matches (nonZeroPairCount stays 1, multi stays 0)
    // — isolating the normalisation effect from the separate multi-pair
    // bonus, which also depends on how many candidate intents are present.
    const customMatrix = {
      ...DEFAULT_COMPLEMENTARITY_MATRIX,
      need_mentor: {
        ...DEFAULT_COMPLEMENTARITY_MATRIX.need_mentor,
        coffee_chat: 0,
        business_networking: 0,
        ai_collaboration: 0,
      },
    };
    const base = intentScore([intent("need_mentor")], [intent("learning")], {
      matrix: customMatrix,
    });
    const withFourCandidateIntents = intentScore(
      [intent("need_mentor")],
      [
        intent("learning"),
        intent("coffee_chat"),
        intent("business_networking"),
        intent("ai_collaboration"),
      ],
      { matrix: customMatrix },
    );
    expect(withFourCandidateIntents).toBeCloseTo(base / Math.sqrt(4 / 3), 5);
  });

  it("does not apply count normalisation at exactly 3 candidate intents", () => {
    // need_mentor -> {learning: .55, coffee_chat: .50, business_networking:
    // .40} — best .55, 3 nonzero pairs -> multi = min(0.15, 0.05*2) = 0.10.
    const score = intentScore(
      [intent("need_mentor")],
      [intent("learning"), intent("coffee_chat"), intent("business_networking")],
    );
    expect(score).toBeCloseTo(Math.min(1.0, 0.55 + 0.1), 5);
  });

  it("returns the 0.15 archived-intent prior when nothing matches and an archived overlap exists", () => {
    const customMatrix = {
      ...DEFAULT_COMPLEMENTARITY_MATRIX,
      looking_for_job: { ...DEFAULT_COMPLEMENTARITY_MATRIX.looking_for_job, hiring: 0 },
    };
    const score = intentScore([intent("looking_for_job")], [intent("hiring")], {
      matrix: customMatrix,
      hasArchivedIntentOverlap: true,
    });
    expect(score).toBe(0.15);
  });

  it("returns 0 (not the archived prior) when nothing matches and there is no archived overlap", () => {
    const customMatrix = {
      ...DEFAULT_COMPLEMENTARITY_MATRIX,
      looking_for_job: { ...DEFAULT_COMPLEMENTARITY_MATRIX.looking_for_job, hiring: 0 },
    };
    const score = intentScore([intent("looking_for_job")], [intent("hiring")], {
      matrix: customMatrix,
    });
    expect(score).toBe(0);
  });
});
