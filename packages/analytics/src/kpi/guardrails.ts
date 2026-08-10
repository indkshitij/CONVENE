// PRD §21.1's guardrail row, transcribed exactly: "Unsolicited-message
// complaints <2% · top-decile inbound ≤25/wk · Global-tier feed share
// <40% · AI-drafted first messages <60% · zero-match availability
// sessions <15%." Each threshold is a hard-coded business constant
// (from the PRD table, not derived), matching every other place this
// codebase pins a PRD-given numeric threshold as a named constant
// rather than a magic number at the call site.
export const GUARDRAIL_THRESHOLDS = {
  unsolicited_message_complaint_rate: 0.02,
  top_decile_inbound_requests_per_week: 25,
  global_tier_feed_share: 0.4,
  ai_drafted_first_message_share: 0.6,
  zero_match_availability_session_rate: 0.15,
} as const;

export type GuardrailName = keyof typeof GUARDRAIL_THRESHOLDS;

export interface GuardrailMetrics {
  unsolicited_message_complaint_rate: number;
  top_decile_inbound_requests_per_week: number;
  global_tier_feed_share: number;
  ai_drafted_first_message_share: number;
  zero_match_availability_session_rate: number;
}

export interface GuardrailBreach {
  guardrail: GuardrailName;
  threshold: number;
  actual: number;
  // §21.1 phrases every one of these five as a strict "<" or "≤" ceiling
  // — none are floors — so "breach" always means "actual value is at or
  // over the ceiling," never "under."
}

export function checkGuardrailBreaches(metrics: GuardrailMetrics): GuardrailBreach[] {
  const breaches: GuardrailBreach[] = [];

  // top_decile_inbound_requests_per_week is the only "≤" (inclusive)
  // guardrail in §21.1's row — the other four are strict "<". A value
  // exactly at the threshold breaches this one but not the others.
  if (
    metrics.top_decile_inbound_requests_per_week >
    GUARDRAIL_THRESHOLDS.top_decile_inbound_requests_per_week
  ) {
    breaches.push({
      guardrail: "top_decile_inbound_requests_per_week",
      threshold: GUARDRAIL_THRESHOLDS.top_decile_inbound_requests_per_week,
      actual: metrics.top_decile_inbound_requests_per_week,
    });
  }

  const strictCeilings: Exclude<GuardrailName, "top_decile_inbound_requests_per_week">[] = [
    "unsolicited_message_complaint_rate",
    "global_tier_feed_share",
    "ai_drafted_first_message_share",
    "zero_match_availability_session_rate",
  ];
  for (const guardrail of strictCeilings) {
    const actual = metrics[guardrail];
    const threshold = GUARDRAIL_THRESHOLDS[guardrail];
    if (actual >= threshold) breaches.push({ guardrail, threshold, actual });
  }

  return breaches;
}
