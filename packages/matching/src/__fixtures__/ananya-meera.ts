import type { ReasonContext } from "../reasons";
import type { SubScores } from "../score";

// PRD §11.6 — the worked example, transcribed as a reusable test fixture.
//
// Viewer: Ananya — SDE-1, 1.5 yrs, Bengaluru, available_now (28 min left),
// intents [need_mentor (primary), learning], skills [Python, Payments,
// SQL, Kafka, ML basics], industry Tech, en+hi, Free plan, L2, rep 54.
//
// Candidate: Meera — Director DS, 16 yrs, Hyderabad (~500km), scheduled
// (Thu window, 22h away, 45min overlap), intents [need_mentee (primary),
// hiring], skills [NLP, LLM, Python, MLOps, Leadership], industry Tech,
// en, Premium, L3, rep 88, 3 mutuals, active 12/14 days.
//
// Sub-score values below are the §11.6 table's own contribution figures
// divided back out by their weights (contribution / weight), NOT the
// table's "Value" column verbatim for every row — the table's `s_exp`
// Value column prints "1.00", which is arithmetically inconsistent with
// its own stated contribution (0.0360 ÷ weight 0.05 = 0.72, not 1.00).
// 0.72 is used here since it's what actually makes the weighted sum equal
// the table's own stated total (0.7152); flagged as a correction of an
// apparent transcription error in the PRD table, not a re-derivation via
// this package's own subscore functions (which — per skills.test.ts and
// languages.test.ts's documented findings — compute different values
// again for s_skill and s_lang than either the table's Value column or
// this fixture; those are a separate, already-flagged discrepancy between
// the PRD's formulas and its own worked-example prose).
export const ANANYA_MEERA_SUB_SCORES: SubScores = {
  avail: 0.65,
  intent: 1.0,
  loc: 0.4,
  skill: 0.58,
  industry: 1.0,
  exp: 0.72,
  interest: 0.45,
  mutual: 0.63,
  activity: 0.85,
  rep: 0.88,
  lang: 1.0,
};

export const ANANYA_MEERA_EXPECTED_WEIGHTED_SUM = 0.7152;
export const ANANYA_MEERA_EXPECTED_SCORE = 79;

// PRD §11.6's prose states "m_verify (L3) = 1.00 · m_plan (Premium) =
// 1.10 · m_stale = 1.00 · m_fatigue = 1.00 · m_convene = 1.00" ->
// 0.7152 x 1.10 = 0.78672 -> 79. But §11.3's own multiplier table maps
// L3 -> 1.05, not 1.00 (L0..L4 = 0.85/0.95/1.00/1.05/1.08) — see
// multipliers.test.ts for this discrepancy in detail. Composing
// computeMultiplier({ verificationLevel: "L3", plan: "premium", ... })
// therefore yields 1.05 x 1.10 = 1.155, NOT the 1.10 needed to reproduce
// this worked example's documented score of 79. This fixture's multiplier
// is the example's literal stated value (1.10), used directly in
// score.test.ts's worked-example assertion, rather than routed through
// computeMultiplier's table-driven L3 lookup.
export const ANANYA_MEERA_MULTIPLIER = 1.1;

// Reason-generation context. locationTier=4 ("same country, different
// state" per §10.5.4's tier table) and sharedSkillCount=1 (only "Python"
// overlaps between the two skill lists) both correctly suppress their
// templates (loc requires tier <= 2; skill requires >= 2 shared) —
// matching why §11.6's own top-3 reasons don't mention location or
// skills despite those sub-scores being nonzero.
export const ANANYA_MEERA_REASON_CONTEXT: ReasonContext = {
  viewerPrimaryIntentType: "need_mentor",
  candidateFirstName: "Meera",
  candidatePrimaryIntentType: "need_mentee",
  candidateAvailabilityState: "scheduled",
  candidateLocationTier: 4,
  sharedSkillCount: 1,
  topSharedSkill: "Python",
  mutualCount: 3,
  candidateYearsExperience: 16,
  candidateIndustryLabel: "Tech",
  expNotable: true,
  sameIndustry: true,
};
