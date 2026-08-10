// PRD §21.3: "Primary funnels: (1) landing → signup → verification →
// wizard completion → first availability session → first conversation;
// (2) availability started → match shown → request sent → accepted →
// conversation → ≥6 mutual messages; (3) paywall shown → checkout →
// trial → paid → renewed." Step names reuse packages/analytics/src/events.ts's
// own event names wherever a 1:1 event exists (`landing_viewed`,
// `availability_started`, `request_sent`, `paywall_shown`, ...). Three
// steps have no single matching event and are named descriptively
// instead: "wizard completion" (the registry only has a *per-step*
// `wizard_step_completed`, not one fired on the whole wizard), "first
// conversation" (no dedicated event; derived from `conversation_created`
// being the user's first), and "≥6 mutual messages" (WMC's own
// threshold — computed by wmc.ts from message rows, never a client-fired
// event at all).
export const ACQUISITION_FUNNEL = [
  "landing_viewed",
  "signup_started",
  "verification_completed",
  "wizard_completed",
  "first_availability_started",
  "first_conversation_created",
] as const;

export const AVAILABILITY_TO_CONVERSATION_FUNNEL = [
  "availability_started",
  "match_preview_shown",
  "request_sent",
  "request_accepted",
  "conversation_created",
  "mutual_wmc_threshold_reached",
] as const;

export const MONETISATION_FUNNEL = [
  "paywall_shown",
  "checkout_started",
  "trial_started",
  "subscription_created",
  "subscription_renewed",
] as const;

export type FunnelStep =
  | (typeof ACQUISITION_FUNNEL)[number]
  | (typeof AVAILABILITY_TO_CONVERSATION_FUNNEL)[number]
  | (typeof MONETISATION_FUNNEL)[number];

export interface FunnelStepEvent {
  userId: string;
  step: FunnelStep;
  timestamp: Date;
}

export interface FunnelStepResult {
  step: FunnelStep;
  reached: number;
  conversionFromPrevious: number | null;
  conversionFromStart: number;
}

// A *strict* funnel: a user counts toward step N only if they also have
// an event for every step before it (not just "ever fired this event in
// isolation") — otherwise a user who, say, only ever fires
// `subscription_renewed` (a data anomaly, or a migrated/legacy account)
// would inflate a later step without ever having passed through the
// earlier ones, which isn't what a funnel is supposed to measure.
export function computeFunnelConversion(
  steps: readonly FunnelStep[],
  events: FunnelStepEvent[],
): FunnelStepResult[] {
  const stepsReachedByUser = new Map<string, Set<FunnelStep>>();
  for (const event of events) {
    const set = stepsReachedByUser.get(event.userId) ?? new Set<FunnelStep>();
    set.add(event.step);
    stepsReachedByUser.set(event.userId, set);
  }

  const totalUsers = stepsReachedByUser.size;
  const results: FunnelStepResult[] = [];
  let previousReached: number | null = null;

  for (let i = 0; i < steps.length; i++) {
    const requiredSteps = steps.slice(0, i + 1);
    let reached = 0;
    for (const userSteps of stepsReachedByUser.values()) {
      if (requiredSteps.every((step) => userSteps.has(step))) reached += 1;
    }
    results.push({
      step: steps[i]!,
      reached,
      conversionFromPrevious:
        previousReached === null ? null : previousReached === 0 ? 0 : reached / previousReached,
      conversionFromStart: totalUsers === 0 ? 0 : reached / totalUsers,
    });
    previousReached = reached;
  }

  return results;
}
