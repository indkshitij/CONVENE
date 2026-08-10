export const PACKAGE_NAME = "@convene/analytics" as const;

export type {
  AnalyticsEnvelope,
  DeniedAnalyticsPayloadKeys,
  DeniedKeysOf,
  Platform,
} from "./schema";
export type { EventName, EventRegistry } from "./events";
export { configureAnalytics, track } from "./track";
export type { AnalyticsSink, EnvelopeProvider, TrackedEvent } from "./track";

export { computeWeeklyMwc, evaluateConversationForWmc, isoWeekStart } from "./kpi/wmc";
export type { WmcConversationResult, WmcMessageInput } from "./kpi/wmc";
export {
  ACQUISITION_FUNNEL,
  AVAILABILITY_TO_CONVERSATION_FUNNEL,
  computeFunnelConversion,
  MONETISATION_FUNNEL,
} from "./kpi/funnels";
export type { FunnelStep, FunnelStepEvent, FunnelStepResult } from "./kpi/funnels";
export { computeRetention, segmentRetentionCohort } from "./kpi/retention";
export type {
  ActivityRecord,
  RetentionCohortUser,
  RetentionResult,
  RetentionSegmentKey,
} from "./kpi/retention";
export { checkGuardrailBreaches, GUARDRAIL_THRESHOLDS } from "./kpi/guardrails";
export type { GuardrailBreach, GuardrailMetrics, GuardrailName } from "./kpi/guardrails";
