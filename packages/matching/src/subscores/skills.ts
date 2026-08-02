import { type FunctionalArea, type IntentFamily, clamp } from "../types";

function normalisedSet(skills: readonly string[]): Set<string> {
  return new Set(skills.map((skill) => skill.toLowerCase()));
}

// PRD §11.5.3: "exact = |V_skills ∩ C_skills| / min(|V_skills|, |C_skills|, 10)."
export function exactSkillOverlap(
  viewerSkills: readonly string[],
  candidateSkills: readonly string[],
): number {
  const viewerSet = normalisedSet(viewerSkills);
  const candidateSet = normalisedSet(candidateSkills);
  const denominator = Math.min(viewerSet.size, candidateSet.size, 10);
  if (denominator === 0) return 0;

  let intersection = 0;
  for (const skill of viewerSet) {
    if (candidateSet.has(skill)) intersection += 1;
  }
  return intersection / denominator;
}

// PRD §11.5.3: "coverage(required, C_skills) = |required ∩ C| / |required|."
export function requiredSkillsCoverage(
  requiredSkills: readonly string[],
  candidateSkills: readonly string[],
): number {
  const requiredSet = normalisedSet(requiredSkills);
  if (requiredSet.size === 0) return 0;
  const candidateSet = normalisedSet(candidateSkills);

  let intersection = 0;
  for (const skill of requiredSet) {
    if (candidateSet.has(skill)) intersection += 1;
  }
  return intersection / requiredSet.size;
}

export interface SkillsScoreInput {
  intentFamily: IntentFamily;
  viewerSkills: readonly string[];
  candidateSkills: readonly string[];
  /**
   * cosine(meanVector(top10(V_skills)), meanVector(top10(C_skills))) —
   * requires skill embeddings, computed upstream (this package has no I/O).
   */
  semanticSimilarity: number;
  /** For the hiring family: "required or V_skills" per §11.5.3. */
  requiredSkills?: readonly string[];
  /** For the cofounder family — see cofounderComplementarity() below. */
  cofounderComplementarityScore?: number;
}

// PRD §11.5.3, translated faithfully: mentorship/learning/ai_collaboration
// share one blend, cofounder delegates entirely to
// cofounderComplementarity(), hiring/job/internship/freelance measure
// coverage of the demand-side required skills, and everything else falls
// back to an even blend.
export function skillsScore(input: SkillsScoreInput): number {
  const exact = exactSkillOverlap(input.viewerSkills, input.candidateSkills);

  switch (input.intentFamily) {
    case "mentorship_seeking":
    case "mentorship_offering":
    case "learning":
    case "ai_collaboration":
      return clamp(0.65 * exact + 0.35 * input.semanticSimilarity, 0, 1);
    case "cofounder": {
      if (input.cofounderComplementarityScore === undefined) {
        throw new Error("skillsScore: the cofounder family requires cofounderComplementarityScore");
      }
      return input.cofounderComplementarityScore;
    }
    case "hiring": {
      const required = input.requiredSkills ?? input.viewerSkills;
      return requiredSkillsCoverage(required, input.candidateSkills);
    }
    case "peer":
      return clamp(0.5 * exact + 0.5 * input.semanticSimilarity, 0, 1);
  }
}

export interface CofounderComplementarityInput {
  /** cosine(v.industry_vec, c.industry_vec) — precomputed upstream. */
  domainOverlap: number;
  viewerFunctionalAreas: readonly FunctionalArea[];
  candidateFunctionalAreas: readonly FunctionalArea[];
}

function jaccard(a: readonly FunctionalArea[], b: readonly FunctionalArea[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 0;

  let intersection = 0;
  for (const area of setA) {
    if (setB.has(area)) intersection += 1;
  }
  return intersection / union.size;
}

// PRD §11.5.3: "cofounderComplementarity = 0.55·domainOverlap +
// 0.45·(1 − functionOverlap)." Ideal: shared domain (high cosine), but
// different functional areas (low Jaccard) — two backend engineers score
// poorly; a backend engineer and a growth lead in the same industry score
// highly.
export function cofounderComplementarity(input: CofounderComplementarityInput): number {
  const functionOverlap = jaccard(input.viewerFunctionalAreas, input.candidateFunctionalAreas);
  return clamp(0.55 * input.domainOverlap + 0.45 * (1 - functionOverlap), 0, 1);
}
