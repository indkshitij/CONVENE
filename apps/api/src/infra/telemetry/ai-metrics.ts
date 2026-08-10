import { Counter } from "prom-client";
import { metricsRegistry } from "./metrics";

// §12.5's guardrail: "if AI-drafted first messages exceed 60% of all
// first messages ... reduce suggestion count from 3 to 1." The >60%
// computation and alerting are external (a Grafana/alerting rule over
// this counter's two label values), same division of responsibility as
// matching_expansion_stage in metrics.ts — this file only emits.
export const aiFirstMessagesTotal = new Counter({
  name: "ai_first_messages_total",
  help: "First messages sent, labelled by whether the sender used an AI-drafted opener (§12.5 60% guardrail).",
  labelNames: ["ai_drafted"],
  registers: [metricsRegistry],
});
