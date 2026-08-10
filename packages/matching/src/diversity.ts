import type { IntentType } from "./types";

// PRD §11.8 diversityInjection: "max 2 per company per page ... max 8
// per industry per page ... max 10 per [primary] intent."
export const DIVERSITY_CAPS = { company: 2, industry: 8, intent: 10 } as const;

// PRD §11.8: "reserve slots 7 and 15 for exploration ... prevents rich-
// get-richer collapse." 1-indexed page positions, as written in the PRD's
// own pseudocode (`out[6], out[14]` are the corresponding 0-indexed array
// slots).
export const EXPLORATION_SLOT_POSITIONS = [7, 15] as const;

// PRD §11.8: "high-variance candidates (new users, score 55-70, never
// shown to this viewer)."
const EXPLORATION_SCORE_MIN = 55;
const EXPLORATION_SCORE_MAX = 70;

export interface DiversityCandidate {
  id: string;
  score: number;
  company: string | null;
  industry: string | null;
  primaryIntent: IntentType | null;
  isNewUser: boolean;
  everShownToViewer: boolean;
}

// PRD §11.8, translated faithfully: a candidate that would exceed any of
// the three per-page caps is deferred (not dropped) rather than scored
// out — it can still appear on this same page as en exploration pick, or
// on a later page via the cursor's normal score/id progression.
export function diversityInjection<T extends DiversityCandidate>(
  sorted: readonly T[],
  pageSize = 20,
): T[] {
  const out: T[] = [];
  const deferred: T[] = [];
  const seenCompany = new Map<string, number>();
  const seenIndustry = new Map<string, number>();
  const seenIntent = new Map<string, number>();

  for (const candidate of sorted) {
    if (out.length >= pageSize) {
      deferred.push(candidate);
      continue;
    }

    const companyCount = candidate.company ? (seenCompany.get(candidate.company) ?? 0) : 0;
    const industryCount = candidate.industry ? (seenIndustry.get(candidate.industry) ?? 0) : 0;
    const intentCount = candidate.primaryIntent
      ? (seenIntent.get(candidate.primaryIntent) ?? 0)
      : 0;

    if (candidate.company && companyCount >= DIVERSITY_CAPS.company) {
      deferred.push(candidate);
      continue;
    }
    if (candidate.industry && industryCount >= DIVERSITY_CAPS.industry) {
      deferred.push(candidate);
      continue;
    }
    if (candidate.primaryIntent && intentCount >= DIVERSITY_CAPS.intent) {
      deferred.push(candidate);
      continue;
    }

    out.push(candidate);
    if (candidate.company) seenCompany.set(candidate.company, companyCount + 1);
    if (candidate.industry) seenIndustry.set(candidate.industry, industryCount + 1);
    if (candidate.primaryIntent) seenIntent.set(candidate.primaryIntent, intentCount + 1);
  }

  const usedIds = new Set(out.map((c) => c.id));
  const pool = [...deferred, ...sorted.filter((c) => !usedIds.has(c.id) && !deferred.includes(c))];

  for (const position of EXPLORATION_SLOT_POSITIONS) {
    const index = position - 1;
    if (index >= out.length) continue; // the page itself is shorter than this slot — nothing to reserve.

    const outgoing = out[index]!;
    // Exploration picks must still respect the same three caps (the
    // acceptance bar is "no page violates a diversity cap," full stop —
    // not "except at positions 7/15") — so the outgoing candidate's own
    // contribution is provisionally removed before searching, and only
    // restored if no eligible replacement exists.
    if (outgoing.company)
      seenCompany.set(outgoing.company, (seenCompany.get(outgoing.company) ?? 1) - 1);
    if (outgoing.industry)
      seenIndustry.set(outgoing.industry, (seenIndustry.get(outgoing.industry) ?? 1) - 1);
    if (outgoing.primaryIntent)
      seenIntent.set(outgoing.primaryIntent, (seenIntent.get(outgoing.primaryIntent) ?? 1) - 1);

    const pick = pickExploration(pool, usedIds, seenCompany, seenIndustry, seenIntent);
    if (!pick) {
      // No eligible replacement anywhere — put the outgoing candidate's
      // counts back exactly as they were and leave the slot untouched.
      if (outgoing.company)
        seenCompany.set(outgoing.company, (seenCompany.get(outgoing.company) ?? 0) + 1);
      if (outgoing.industry)
        seenIndustry.set(outgoing.industry, (seenIndustry.get(outgoing.industry) ?? 0) + 1);
      if (outgoing.primaryIntent)
        seenIntent.set(outgoing.primaryIntent, (seenIntent.get(outgoing.primaryIntent) ?? 0) + 1);
      continue;
    }

    usedIds.delete(outgoing.id);
    out[index] = pick;
    usedIds.add(pick.id);
    if (pick.company) seenCompany.set(pick.company, (seenCompany.get(pick.company) ?? 0) + 1);
    if (pick.industry) seenIndustry.set(pick.industry, (seenIndustry.get(pick.industry) ?? 0) + 1);
    if (pick.primaryIntent)
      seenIntent.set(pick.primaryIntent, (seenIntent.get(pick.primaryIntent) ?? 0) + 1);
  }

  return out;
}

function withinCaps<T extends DiversityCandidate>(
  candidate: T,
  seenCompany: ReadonlyMap<string, number>,
  seenIndustry: ReadonlyMap<string, number>,
  seenIntent: ReadonlyMap<string, number>,
): boolean {
  if (candidate.company && (seenCompany.get(candidate.company) ?? 0) >= DIVERSITY_CAPS.company)
    return false;
  if (candidate.industry && (seenIndustry.get(candidate.industry) ?? 0) >= DIVERSITY_CAPS.industry)
    return false;
  if (
    candidate.primaryIntent &&
    (seenIntent.get(candidate.primaryIntent) ?? 0) >= DIVERSITY_CAPS.intent
  )
    return false;
  return true;
}

// Prefers a genuine high-variance pick (new user, mid-band score, never
// shown to this viewer); falls back to the next cap-respecting pooled
// candidate so an exploration slot is never simply left empty just
// because no "ideal" explorer exists in this candidate set — but never
// falls back to a cap-violating one, since the caps are the harder
// constraint (§11.8's own acceptance bar).
function pickExploration<T extends DiversityCandidate>(
  pool: readonly T[],
  excludeIds: ReadonlySet<string>,
  seenCompany: ReadonlyMap<string, number>,
  seenIndustry: ReadonlyMap<string, number>,
  seenIntent: ReadonlyMap<string, number>,
): T | null {
  const eligible = pool.filter(
    (c) => !excludeIds.has(c.id) && withinCaps(c, seenCompany, seenIndustry, seenIntent),
  );
  const ideal = eligible.find(
    (c) =>
      c.isNewUser &&
      !c.everShownToViewer &&
      c.score >= EXPLORATION_SCORE_MIN &&
      c.score <= EXPLORATION_SCORE_MAX,
  );
  return ideal ?? eligible[0] ?? null;
}
