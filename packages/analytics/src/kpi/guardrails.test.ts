import { describe, expect, it } from "vitest";
import { checkGuardrailBreaches, type GuardrailMetrics } from "./guardrails";

function healthyMetrics(): GuardrailMetrics {
  return {
    unsolicited_message_complaint_rate: 0.01,
    top_decile_inbound_requests_per_week: 20,
    global_tier_feed_share: 0.3,
    ai_drafted_first_message_share: 0.5,
    zero_match_availability_session_rate: 0.1,
  };
}

describe("checkGuardrailBreaches", () => {
  it("reports no breaches when every metric is comfortably within bounds", () => {
    expect(checkGuardrailBreaches(healthyMetrics())).toEqual([]);
  });

  it("flags each guardrail independently when it alone breaches", () => {
    for (const [guardrail, badValue] of [
      ["unsolicited_message_complaint_rate", 0.02],
      ["top_decile_inbound_requests_per_week", 26],
      ["global_tier_feed_share", 0.4],
      ["ai_drafted_first_message_share", 0.6],
      ["zero_match_availability_session_rate", 0.15],
    ] as const) {
      const metrics = { ...healthyMetrics(), [guardrail]: badValue };
      const breaches = checkGuardrailBreaches(metrics);
      expect(breaches).toHaveLength(1);
      expect(breaches[0]!.guardrail).toBe(guardrail);
    }
  });

  it("top_decile_inbound_requests_per_week is inclusive (≤ 25 is fine, 26 breaches) while the rest are strict (< threshold, so exactly-at-threshold breaches)", () => {
    // Exactly at the ceiling: the "≤" guardrail should NOT breach at 25...
    expect(
      checkGuardrailBreaches({ ...healthyMetrics(), top_decile_inbound_requests_per_week: 25 }),
    ).toEqual([]);
    // ...but a strict "<" guardrail DOES breach exactly at its threshold.
    const breaches = checkGuardrailBreaches({ ...healthyMetrics(), global_tier_feed_share: 0.4 });
    expect(breaches).toHaveLength(1);
    expect(breaches[0]!.guardrail).toBe("global_tier_feed_share");
  });

  it("reports multiple simultaneous breaches", () => {
    const metrics: GuardrailMetrics = {
      ...healthyMetrics(),
      unsolicited_message_complaint_rate: 0.05,
      ai_drafted_first_message_share: 0.9,
    };
    const breaches = checkGuardrailBreaches(metrics);
    expect(breaches.map((b) => b.guardrail).sort()).toEqual([
      "ai_drafted_first_message_share",
      "unsolicited_message_complaint_rate",
    ]);
  });
});
