import { describe, expect, it } from "vitest";
import {
  cofounderComplementarity,
  exactSkillOverlap,
  requiredSkillsCoverage,
  skillsScore,
} from "./skills";

describe("exactSkillOverlap", () => {
  it("computes |intersection| / min(|V|,|C|,10)", () => {
    const overlap = exactSkillOverlap(
      ["Python", "Payments", "SQL", "Kafka", "ML basics"],
      ["NLP", "LLM", "Python", "MLOps", "Leadership"],
    );
    expect(overlap).toBeCloseTo(1 / 5, 5);
  });

  it("is case-insensitive", () => {
    expect(exactSkillOverlap(["React"], ["react"])).toBeCloseTo(1, 5);
  });

  it("caps the denominator at 10 even with larger skill lists", () => {
    const viewerSkills = Array.from({ length: 15 }, (_, i) => `skill-${i}`);
    const candidateSkills = ["skill-0", "skill-1"];
    // min(15, 2, 10) = 2 (the candidate's own count is the binding min here)
    expect(exactSkillOverlap(viewerSkills, candidateSkills)).toBeCloseTo(2 / 2, 5);
  });

  it("returns 0 when either list is empty", () => {
    expect(exactSkillOverlap([], ["Python"])).toBe(0);
    expect(exactSkillOverlap(["Python"], [])).toBe(0);
  });
});

describe("requiredSkillsCoverage", () => {
  it("computes |required ∩ C| / |required|", () => {
    expect(
      requiredSkillsCoverage(["Backend", "ML Engineering"], ["Backend", "Frontend"]),
    ).toBeCloseTo(0.5, 5);
  });

  it("returns 0 when required is empty", () => {
    expect(requiredSkillsCoverage([], ["Backend"])).toBe(0);
  });
});

describe("cofounderComplementarity", () => {
  it("scores highly for high domain overlap and low functional overlap", () => {
    const score = cofounderComplementarity({
      domainOverlap: 0.8,
      viewerFunctionalAreas: ["engineering"],
      candidateFunctionalAreas: ["growth_marketing"],
    });
    // 0.55*0.8 + 0.45*(1-0) = 0.44 + 0.45 = 0.89
    expect(score).toBeCloseTo(0.89, 5);
  });

  it("scores poorly for two engineers (full functional overlap)", () => {
    const score = cofounderComplementarity({
      domainOverlap: 0.8,
      viewerFunctionalAreas: ["engineering"],
      candidateFunctionalAreas: ["engineering"],
    });
    // 0.55*0.8 + 0.45*(1-1) = 0.44
    expect(score).toBeCloseTo(0.44, 5);
  });

  it("returns 0 functional overlap (and thus the full 0.45 term) when both areas lists are empty", () => {
    const score = cofounderComplementarity({
      domainOverlap: 0.5,
      viewerFunctionalAreas: [],
      candidateFunctionalAreas: [],
    });
    expect(score).toBeCloseTo(0.55 * 0.5 + 0.45, 5);
  });

  it("clamps the result to [0, 1]", () => {
    const score = cofounderComplementarity({
      domainOverlap: 1,
      viewerFunctionalAreas: [],
      candidateFunctionalAreas: ["legal"],
    });
    expect(score).toBeLessThanOrEqual(1);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

describe("skillsScore", () => {
  // PRD §11.6's worked example states s_skill=0.58 for this exact input
  // ("Mentorship family: exact overlap {Python} = 0.20; semantic 0.72"),
  // but 0.65×0.20 + 0.35×0.72 = 0.382, not 0.58 — the PRD's own formula
  // (§11.5.3) and its own worked-example table disagree. This test
  // asserts what §11.5.3's formula actually produces, not the
  // inconsistent table figure; flagged here and in the PR description
  // rather than silently matching whichever number was chosen.
  it("computes the mentorship-family blend (§11.5.3 formula, not the inconsistent §11.6 table value)", () => {
    const score = skillsScore({
      intentFamily: "mentorship_seeking",
      viewerSkills: ["Python", "Payments", "SQL", "Kafka", "ML basics"],
      candidateSkills: ["NLP", "LLM", "Python", "MLOps", "Leadership"],
      semanticSimilarity: 0.72,
    });
    expect(score).toBeCloseTo(0.65 * 0.2 + 0.35 * 0.72, 5);
  });

  it("applies the same blend for mentorship_offering, learning and ai_collaboration", () => {
    const base = {
      viewerSkills: ["Python"],
      candidateSkills: ["Python"],
      semanticSimilarity: 0.5,
    };
    const expected = 0.65 * 1 + 0.35 * 0.5;
    expect(skillsScore({ ...base, intentFamily: "mentorship_offering" })).toBeCloseTo(expected, 5);
    expect(skillsScore({ ...base, intentFamily: "learning" })).toBeCloseTo(expected, 5);
    expect(skillsScore({ ...base, intentFamily: "ai_collaboration" })).toBeCloseTo(expected, 5);
  });

  it("delegates to cofounderComplementarityScore for the cofounder family", () => {
    const score = skillsScore({
      intentFamily: "cofounder",
      viewerSkills: [],
      candidateSkills: [],
      semanticSimilarity: 0,
      cofounderComplementarityScore: 0.73,
    });
    expect(score).toBe(0.73);
  });

  it("throws for the cofounder family when cofounderComplementarityScore is missing", () => {
    expect(() =>
      skillsScore({
        intentFamily: "cofounder",
        viewerSkills: [],
        candidateSkills: [],
        semanticSimilarity: 0,
      }),
    ).toThrow(/cofounderComplementarityScore/);
  });

  it("uses requiredSkills coverage for the hiring family when required skills are supplied", () => {
    const score = skillsScore({
      intentFamily: "hiring",
      viewerSkills: ["Backend"],
      candidateSkills: ["Backend", "Frontend"],
      semanticSimilarity: 0,
      requiredSkills: ["Backend", "ML Engineering"],
    });
    expect(score).toBeCloseTo(0.5, 5);
  });

  it("falls back to viewerSkills as the required set for the hiring family", () => {
    const score = skillsScore({
      intentFamily: "hiring",
      viewerSkills: ["Backend"],
      candidateSkills: ["Backend", "Frontend"],
      semanticSimilarity: 0,
    });
    expect(score).toBeCloseTo(1, 5);
  });

  it("applies the even 0.5/0.5 blend for the peer family", () => {
    const score = skillsScore({
      intentFamily: "peer",
      viewerSkills: ["Python"],
      candidateSkills: ["Python"],
      semanticSimilarity: 0.5,
    });
    expect(score).toBeCloseTo(0.5 * 1 + 0.5 * 0.5, 5);
  });
});
