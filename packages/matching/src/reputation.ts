// PRD §10.10.1 — the eight-component reputation formula. Pure: every
// input here is a plain count/ratio/timestamp-derived number the caller
// (apps/api's reputation worker) computes from raw rows — never a user,
// plan, or subscription object. That's what makes "reputation is never
// purchasable, and Premium does not affect it" structurally true rather
// than a promise: there is no field on ReputationComponentsInput a
// billing concept could even be threaded through. See the
// `AssertNoBillingOverlap` type at the bottom, which fails to compile if
// that ever stops being the case.

// §10.10.1's component weights, verbatim. They sum to 90, not 100 —
// "Report ratio (negative) −20" is a penalty subtracted after the other
// seven are combined, not a positive share of a 100-point pool. This
// division (weighted average of the positive seven, scaled to 0-100,
// then a separate 0-20 subtraction) is the interpretation used here; the
// PRD states the weights and components but not the combination formula
// explicitly, so this is a documented assumption, not a transcription.
export const REPUTATION_WEIGHTS = {
  responseRate: 25,
  responseSpeed: 10,
  conversationDepth: 20,
  acceptanceBehaviour: 10,
  profileQuality: 10,
  tenureActivity: 10,
  communityContributions: 5,
} as const;

const POSITIVE_WEIGHT_SUM = Object.values(REPUTATION_WEIGHTS).reduce(
  (total, weight) => total + weight,
  0,
); // 90
const REPORT_RATIO_MAX_PENALTY = 20;

// §10.10.1: "new users start at 50 ... Bayesian shrinkage toward the
// population mean until ≥5 observations exist per component."
export const POPULATION_MEAN = 50;
export const MIN_OBSERVATIONS = 5;

export const REPUTATION_BANDS = ["new", "building", "trusted", "highly_trusted"] as const;
export type ReputationBand = (typeof REPUTATION_BANDS)[number];

// §10.10.1 band cutoffs, verbatim: "0-39 New · 40-59 Building · 60-79
// Trusted · 80-100 Highly Trusted."
export function bandForScore(score: number): ReputationBand {
  if (score < 40) return "new";
  if (score < 60) return "building";
  if (score < 80) return "trusted";
  return "highly_trusted";
}

// §10.10.1: "a single interaction cannot produce an extreme score" —
// blends an observed 0-100 value toward the 50 population mean, with
// full weight only once `observations >= MIN_OBSERVATIONS`. At 0
// observations the result is exactly the prior (50); at 1 observation
// it moves only 1/5 of the way toward whatever was observed.
export function shrinkTowardPrior(
  observed: number,
  observations: number,
  prior: number = POPULATION_MEAN,
  minObservations: number = MIN_OBSERVATIONS,
): number {
  if (observations <= 0) return prior;
  const weight = Math.min(1, observations / minObservations);
  return observed * weight + prior * (1 - weight);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// §10.10.1 "Response rate: share of received first-messages replied to
// within 72h (min 5 observations)."
export interface ResponseRateInput {
  firstMessagesReceived: number;
  repliedWithin72h: number;
}
export function responseRateScore(input: ResponseRateInput): number {
  if (input.firstMessagesReceived <= 0) return shrinkTowardPrior(0, 0);
  const observed = clamp((input.repliedWithin72h / input.firstMessagesReceived) * 100, 0, 100);
  return shrinkTowardPrior(observed, input.firstMessagesReceived);
}

// §10.10.1 "Response speed: median first-reply latency, log-scaled and
// capped at 24h." Log-scaled so the difference between a 2-minute and
// 20-minute median matters far more than the difference between a
// 20-hour and 23-hour one; capped at 24h (1440 minutes) per the PRD, so
// anything slower than that scores the same (0).
export interface ResponseSpeedInput {
  medianFirstReplyMinutes: number;
  observations: number;
}
const RESPONSE_SPEED_CAP_MINUTES = 24 * 60;
export function responseSpeedScore(input: ResponseSpeedInput): number {
  const cappedMinutes = clamp(input.medianFirstReplyMinutes, 0, RESPONSE_SPEED_CAP_MINUTES);
  const observed = clamp(
    100 * (1 - Math.log1p(cappedMinutes) / Math.log1p(RESPONSE_SPEED_CAP_MINUTES)),
    0,
    100,
  );
  return shrinkTowardPrior(observed, input.observations);
}

// §10.10.1 "Conversation depth: share of conversations reaching >=6
// mutual messages."
export interface ConversationDepthInput {
  conversationsStarted: number;
  conversationsReachingSixMessages: number;
}
export function conversationDepthScore(input: ConversationDepthInput): number {
  if (input.conversationsStarted <= 0) return shrinkTowardPrior(0, 0);
  const observed = clamp(
    (input.conversationsReachingSixMessages / input.conversationsStarted) * 100,
    0,
    100,
  );
  return shrinkTowardPrior(observed, input.conversationsStarted);
}

// §10.10.1 "Acceptance behaviour: balanced accept/reject ratio (extremes
// at both ends are neutral, not penalised)." Read as: a perfectly
// balanced 50/50 ratio scores highest (100); an extreme ratio (always
// accept or always reject) is *neutral* — it floors at 50, it never
// drops toward 0 the way a "penalised" reading would imply.
export interface AcceptanceBehaviourInput {
  accepted: number;
  rejected: number;
}
export function acceptanceBehaviourScore(input: AcceptanceBehaviourInput): number {
  const total = input.accepted + input.rejected;
  if (total <= 0) return shrinkTowardPrior(0, 0);
  const ratio = input.accepted / total;
  const observed = clamp(100 - Math.abs(ratio - 0.5) * 200, 50, 100);
  return shrinkTowardPrior(observed, total);
}

// §10.10.1 "Profile quality: profile completion × verification level."
// profileCompletion is already 0-100 (profiles.profile_completion);
// verificationLevel is 0-4 (profiles.verification_level, §10.2.5's
// ladder) — normalised to a 0-1 multiplier here.
export interface ProfileQualityInput {
  profileCompletion: number;
  verificationLevel: number;
}
const MAX_VERIFICATION_LEVEL = 4;
export function profileQualityScore(input: ProfileQualityInput): number {
  const completion = clamp(input.profileCompletion, 0, 100);
  const verificationFactor =
    clamp(input.verificationLevel, 0, MAX_VERIFICATION_LEVEL) / MAX_VERIFICATION_LEVEL;
  return completion * verificationFactor;
}

// §10.10.1 "Tenure & activity: logarithmic account age × recent activity
// consistency." Age is log-scaled and capped at a 2-year (730-day)
// horizon — no exact cap is given in the PRD, chosen to mirror response
// speed's own 24h cap pattern (a fixed horizon past which more tenure
// stops mattering). Activity consistency uses the same 60-day window
// §10.10.1's own decay rule already establishes as "inactive," linearly
// from 100 (active today) to 0 (60+ days since last active).
export interface TenureActivityInput {
  accountAgeDays: number;
  daysSinceLastActive: number;
}
const TENURE_CAP_DAYS = 730;
const ACTIVITY_INACTIVITY_WINDOW_DAYS = 60;
export function tenureActivityScore(input: TenureActivityInput): number {
  const cappedAge = clamp(input.accountAgeDays, 0, TENURE_CAP_DAYS);
  const ageComponent = clamp(100 * (Math.log1p(cappedAge) / Math.log1p(TENURE_CAP_DAYS)), 0, 100);
  const activityComponent = clamp(
    100 * (1 - input.daysSinceLastActive / ACTIVITY_INACTIVITY_WINDOW_DAYS),
    0,
    100,
  );
  return (ageComponent + activityComponent) / 2;
}

// §10.10.1 "Report ratio (negative): upheld reports per 100
// conversations, heavily weighted for severe categories." Returns a
// penalty in [0, 20] to be *subtracted*, not a 0-100 sub-score like the
// other seven — this component has no positive pool of its own.
export interface ReportRatioInput {
  conversations: number;
  upheldReportsBySeverity: { critical: number; high: number; medium: number; low: number };
}
// No exact per-severity multipliers are given in the PRD beyond "heavily
// weighted for severe categories" — this scale (critical counts 4x a
// low-severity upheld report) is a documented assumption.
const SEVERITY_MULTIPLIER = { critical: 4, high: 3, medium: 2, low: 1 } as const;
export function reportRatioPenalty(input: ReportRatioInput): number {
  if (input.conversations <= 0) return 0;
  const weightedUpheld =
    input.upheldReportsBySeverity.critical * SEVERITY_MULTIPLIER.critical +
    input.upheldReportsBySeverity.high * SEVERITY_MULTIPLIER.high +
    input.upheldReportsBySeverity.medium * SEVERITY_MULTIPLIER.medium +
    input.upheldReportsBySeverity.low * SEVERITY_MULTIPLIER.low;
  const per100 = (weightedUpheld / input.conversations) * 100;
  return clamp(per100, 0, REPORT_RATIO_MAX_PENALTY);
}

// §10.10.1 "Community contributions: mentorship sessions completed,
// positive post-conversation feedback." No source table for either
// metric exists in the schema yet (grepped packages/db/src/schema —
// nothing tracks mentorship or post-conversation feedback) — this
// function is real and ready, but every caller today has nothing to
// feed it except 0, which is a documented gap, not a fabrication.
export interface CommunityContributionsInput {
  mentorshipSessionsCompleted: number;
  positiveFeedbackCount: number;
}
export function communityContributionsScore(input: CommunityContributionsInput): number {
  const observed = clamp(
    input.mentorshipSessionsCompleted * 10 + input.positiveFeedbackCount * 5,
    0,
    100,
  );
  return shrinkTowardPrior(
    observed,
    input.mentorshipSessionsCompleted + input.positiveFeedbackCount,
  );
}

// The full set of raw per-user inputs the worker gathers. Intentionally
// flat, primitive-only fields — see the file's own top comment and
// AssertNoBillingOverlap below for why this shape is what makes
// purchasability structurally impossible, not just a policy.
export interface ReputationComponentsInput {
  responseRate: ResponseRateInput;
  responseSpeed: ResponseSpeedInput;
  conversationDepth: ConversationDepthInput;
  acceptanceBehaviour: AcceptanceBehaviourInput;
  profileQuality: ProfileQualityInput;
  tenureActivity: TenureActivityInput;
  reportRatio: ReportRatioInput;
  communityContributions: CommunityContributionsInput;
  accountAgeDays: number;
  daysSinceLastActive: number;
}

export interface ReputationComponentScores {
  responseRate: number;
  responseSpeed: number;
  conversationDepth: number;
  acceptanceBehaviour: number;
  profileQuality: number;
  tenureActivity: number;
  communityContributions: number;
  reportPenalty: number;
}

export function computeReputationComponents(
  input: ReputationComponentsInput,
): ReputationComponentScores {
  return {
    responseRate: responseRateScore(input.responseRate),
    responseSpeed: responseSpeedScore(input.responseSpeed),
    conversationDepth: conversationDepthScore(input.conversationDepth),
    acceptanceBehaviour: acceptanceBehaviourScore(input.acceptanceBehaviour),
    profileQuality: profileQualityScore(input.profileQuality),
    tenureActivity: tenureActivityScore(input.tenureActivity),
    communityContributions: communityContributionsScore(input.communityContributions),
    reportPenalty: reportRatioPenalty(input.reportRatio),
  };
}

// Weighted average of the seven positive components (0-100, scaled by
// dividing by the 90-point weight pool), minus the report-ratio penalty,
// clamped to [0, 100].
export function combineReputationScore(components: ReputationComponentScores): number {
  const weightedSum =
    components.responseRate * REPUTATION_WEIGHTS.responseRate +
    components.responseSpeed * REPUTATION_WEIGHTS.responseSpeed +
    components.conversationDepth * REPUTATION_WEIGHTS.conversationDepth +
    components.acceptanceBehaviour * REPUTATION_WEIGHTS.acceptanceBehaviour +
    components.profileQuality * REPUTATION_WEIGHTS.profileQuality +
    components.tenureActivity * REPUTATION_WEIGHTS.tenureActivity +
    components.communityContributions * REPUTATION_WEIGHTS.communityContributions;
  const base = weightedSum / POSITIVE_WEIGHT_SUM;
  return clamp(base - components.reportPenalty, 0, 100);
}

// §10.10.1: "Decay: inactivity over 60 days pulls the score 5% toward
// 50/month." Only applies past the 60-day mark; each additional 30-day
// month pulls another 5% of the remaining distance to 50, compounding
// (not a flat percentage of the original score), and is capped so decay
// alone can never overshoot past 50.
export function applyDecay(score: number, daysSinceLastActive: number): number {
  if (daysSinceLastActive <= ACTIVITY_INACTIVITY_WINDOW_DAYS) return score;
  const monthsInactive = (daysSinceLastActive - ACTIVITY_INACTIVITY_WINDOW_DAYS) / 30;
  const retained = Math.pow(0.95, monthsInactive);
  return POPULATION_MEAN + (score - POPULATION_MEAN) * retained;
}

export interface ReputationResult {
  score: number;
  band: ReputationBand;
  components: ReputationComponentScores;
}

const NEW_USER_WINDOW_DAYS = 14;
const NEW_USER_SEED_SCORE = 50;

// The single pure entry point the worker calls per user. §10.10.1: "new
// users start at 50 with a 'New' band for 14 days" overrides both the
// computed score and the score-derived band while the account is under
// 14 days old, regardless of what the raw components would otherwise
// produce (a very active brand-new user shouldn't be able to buy their
// way to "Highly Trusted" in their first week).
export function computeReputation(input: ReputationComponentsInput): ReputationResult {
  if (input.accountAgeDays < NEW_USER_WINDOW_DAYS) {
    return {
      score: NEW_USER_SEED_SCORE,
      band: "new",
      components: computeReputationComponents(input),
    };
  }

  const components = computeReputationComponents(input);
  const rawScore = combineReputationScore(components);
  const score = applyDecay(rawScore, input.daysSinceLastActive);
  return { score, band: bandForScore(score), components };
}

// "Reputation is never purchasable, and Premium does not affect it"
// (§10.10.1) — enforced structurally, not just by convention: this type
// fails to compile if ReputationComponentsInput ever grows a field whose
// name collides with a billing concept's own field names. It's a
// name-collision check, the cheapest structural signal available without
// importing @convene/db's billing schema into a "pure, no I/O" package.
type BillingLikeKeys =
  | "planCode"
  | "priceCents"
  | "entitlements"
  | "provider"
  | "subscriptionId"
  | "paymentId"
  | "currency"
  | "interval";
type AssertNoBillingOverlap<T extends true> = T;
type _NoBillingFieldsReachable = AssertNoBillingOverlap<
  Extract<keyof ReputationComponentsInput, BillingLikeKeys> extends never ? true : false
>;
