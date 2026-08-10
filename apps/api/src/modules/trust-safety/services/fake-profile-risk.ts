// §12.9's composite signal list, transcribed as a pure, I/O-free scoring
// function (same "no I/O" discipline as packages/matching's own
// subscores) — the caller gathers real signals from the DB/media
// pipeline, this only combines them. Deliberately excludes any field
// this module's own README/§12.9 names as forbidden.
//
// §12.9: "no signal may use ethnicity, name origin, country of
// residence, or language as a risk factor." This interface has no field
// any of those could occupy — the anti-bias test in
// fake-profile-risk.test.ts exercises this the same way
// packages/matching/src/anti-bias.test.ts does for matching inputs.
export interface FakeProfileSignals {
  avatarMatchesKnownDuplicate: boolean;
  faceCountAbnormal: boolean;
  imageQualityLow: boolean;
  nameEntropyLow: boolean; // A generic/generated-pattern flag (e.g. "user8827x2"), never a judgement about which names look "foreign."
  experienceTimelineImpossible: boolean;
  claimedCompanyUnverifiedWithSeniorityClaim: boolean;
  disposableEmail: boolean;
  deviceIpClusterFlagCount: number;
  aboutTextScamTemplateSimilarity: number; // 0-1
  immediateMassRequests: boolean;
  identicalNoteRatio: number; // 0-1
  offPlatformSolicitationInFirstMessage: boolean;
}

export type FakeProfileAction =
  | "none"
  | "soft_verification_challenge"
  | "hide_and_review"
  | "immediate_suspension_pending_review";

export interface FakeProfileRiskResult {
  score: number; // 0-1
  action: FakeProfileAction;
  factors: string[]; // Which signals actually fired — for the human reviewer, never persisted as a "why we suspect this person" narrative about who they are.
}

// Weights are a documented, defensible allocation (the PRD lists the
// signals but not exact weights) — behavioural/technical fraud signals
// dominate; nothing here is a demographic proxy.
const WEIGHTS = {
  avatarMatchesKnownDuplicate: 0.2,
  faceCountAbnormal: 0.08,
  imageQualityLow: 0.04,
  nameEntropyLow: 0.06,
  experienceTimelineImpossible: 0.12,
  claimedCompanyUnverifiedWithSeniorityClaim: 0.1,
  disposableEmail: 0.08,
  aboutTextScamTemplateSimilarity: 0.12,
  immediateMassRequests: 0.08,
  offPlatformSolicitationInFirstMessage: 0.12,
} as const;

function actionForScore(score: number): FakeProfileAction {
  if (score > 0.9) return "immediate_suspension_pending_review";
  if (score > 0.7) return "hide_and_review";
  if (score >= 0.4) return "soft_verification_challenge";
  return "none";
}

export function computeFakeProfileRisk(signals: FakeProfileSignals): FakeProfileRiskResult {
  let score = 0;
  const factors: string[] = [];

  for (const [key, weight] of Object.entries(WEIGHTS) as [keyof typeof WEIGHTS, number][]) {
    const value = signals[key];
    if (typeof value === "boolean" && value) {
      score += weight;
      factors.push(key);
    } else if (typeof value === "number" && value > 0) {
      score += weight * value;
      if (value >= 0.5) factors.push(key);
    }
  }

  // Two signals scaled continuously outside the weight table above (a
  // count and a ratio, not booleans/0-1 scores) — clamped contributions
  // so a large cluster or a spike of identical notes can't single-
  // handedly dominate the composite the way a real duplicate avatar
  // match should.
  const clusterContribution = Math.min(signals.deviceIpClusterFlagCount / 5, 1) * 0.06;
  if (clusterContribution > 0) {
    score += clusterContribution;
    factors.push("deviceIpClusterFlagCount");
  }
  const identicalNoteContribution = Math.min(signals.identicalNoteRatio, 1) * 0.04;
  if (identicalNoteContribution > 0) {
    score += identicalNoteContribution;
    factors.push("identicalNoteRatio");
  }

  const clampedScore = Math.min(1, Math.max(0, score));
  return { score: clampedScore, action: actionForScore(clampedScore), factors };
}
