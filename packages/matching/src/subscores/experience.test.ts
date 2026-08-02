import { describe, expect, it } from "vitest";
import { experienceScore } from "./experience";

describe("experienceScore", () => {
  // PRD §11.6 worked example: Ananya (1.5 yrs) x Meera (16 yrs),
  // mentorship-seeking: d = +14.5, ideal +6, tol 6 -> Gaussian ~= 0.36.
  // (The table's aside about a "capped-tolerance variant ... tol=10 ->
  // 0.72" isn't reflected anywhere in §11.5.4's own pseudocode — no
  // threshold or rule is given for when it would apply — so it's treated
  // as unspecified narrative colour, not implemented.)
  it("matches the §11.6 worked example for mentorship_seeking", () => {
    const score = experienceScore({
      viewerYearsExperience: 1.5,
      candidateYearsExperience: 16,
      intentFamily: "mentorship_seeking",
    });
    expect(score).toBeCloseTo(0.3666, 3);
  });

  it("peaks at 1.0 for mentorship_seeking when the candidate is exactly 6 years ahead", () => {
    const score = experienceScore({
      viewerYearsExperience: 2,
      candidateYearsExperience: 8,
      intentFamily: "mentorship_seeking",
    });
    expect(score).toBeCloseTo(1.0, 5);
  });

  it("peaks at 1.0 for mentorship_offering when the candidate is exactly 6 years behind", () => {
    const score = experienceScore({
      viewerYearsExperience: 10,
      candidateYearsExperience: 4,
      intentFamily: "mentorship_offering",
    });
    expect(score).toBeCloseTo(1.0, 5);
  });

  it("peaks at 1.0 for cofounder when years are equal", () => {
    const score = experienceScore({
      viewerYearsExperience: 5,
      candidateYearsExperience: 5,
      intentFamily: "cofounder",
    });
    expect(score).toBeCloseTo(1.0, 5);
  });

  it("peaks at 1.0 for peer/ai_collaboration/learning when years are equal", () => {
    const input = { viewerYearsExperience: 5, candidateYearsExperience: 5 };
    expect(experienceScore({ ...input, intentFamily: "peer" })).toBeCloseTo(1.0, 5);
    expect(experienceScore({ ...input, intentFamily: "ai_collaboration" })).toBeCloseTo(1.0, 5);
    expect(experienceScore({ ...input, intentFamily: "learning" })).toBeCloseTo(1.0, 5);
  });

  it("never returns below the 0.10 floor even for a huge gap", () => {
    const score = experienceScore({
      viewerYearsExperience: 0,
      candidateYearsExperience: 50,
      intentFamily: "peer",
    });
    expect(score).toBeCloseTo(0.1, 5);
  });

  describe("hiring family", () => {
    it("returns 1.0 when the candidate is within the seniority range", () => {
      const score = experienceScore({
        viewerYearsExperience: 0,
        candidateYearsExperience: 5,
        intentFamily: "hiring",
        seniorityRange: { min: 3, max: 8 },
      });
      expect(score).toBeCloseTo(1.0, 5);
    });

    it("returns 1.0 at the exact range boundaries", () => {
      const min = experienceScore({
        viewerYearsExperience: 0,
        candidateYearsExperience: 3,
        intentFamily: "hiring",
        seniorityRange: { min: 3, max: 8 },
      });
      const max = experienceScore({
        viewerYearsExperience: 0,
        candidateYearsExperience: 8,
        intentFamily: "hiring",
        seniorityRange: { min: 3, max: 8 },
      });
      expect(min).toBeCloseTo(1.0, 5);
      expect(max).toBeCloseTo(1.0, 5);
    });

    it("decays below the range's minimum", () => {
      const score = experienceScore({
        viewerYearsExperience: 0,
        candidateYearsExperience: 1,
        intentFamily: "hiring",
        seniorityRange: { min: 3, max: 8 },
      });
      expect(score).toBeLessThan(1.0);
      expect(score).toBeGreaterThanOrEqual(0.1);
    });

    it("decays above the range's maximum", () => {
      const score = experienceScore({
        viewerYearsExperience: 0,
        candidateYearsExperience: 20,
        intentFamily: "hiring",
        seniorityRange: { min: 3, max: 8 },
      });
      expect(score).toBeLessThan(1.0);
      expect(score).toBeGreaterThanOrEqual(0.1);
    });

    it("throws when seniorityRange is missing", () => {
      expect(() =>
        experienceScore({
          viewerYearsExperience: 0,
          candidateYearsExperience: 5,
          intentFamily: "hiring",
        }),
      ).toThrow(/seniorityRange/);
    });
  });
});
