import type { DeniedAnalyticsPayloadKeys } from "./schema";

// PRD §21.2's event taxonomy, transcribed table row by row. Every event
// name is `object_action`, snake_case, past tense, per that section's
// own naming rule. Payload shapes are this file's own judgment call
// where the table only gives a parenthetical hint (e.g. "duration,
// intents, trigger") rather than an exact field list — kept to bucketed/
// enum/count/boolean fields throughout, never a free-text or coordinate
// field, which is what makes the deny-list assertion at the bottom of
// this file able to stay green.

// ---- Acquisition ----
export interface SignupStartedPayload {
  method: "email" | "phone" | "google" | "linkedin" | "apple";
}
export interface SignupStepCompletedPayload {
  step: number;
}
export interface SignupCompletedPayload {
  method: "email" | "phone" | "google" | "linkedin" | "apple";
}
export interface VerificationCompletedPayload {
  level: number;
}
export interface OauthUsedPayload {
  provider: "google" | "linkedin";
}

// ---- Onboarding ----
export interface WizardStepViewedPayload {
  step: number;
}
export interface WizardStepCompletedPayload {
  step: number;
  duration_ms: number;
}
export interface WizardStepSkippedPayload {
  step: number;
}
export interface IntentSelectedPayload {
  intent_type: string;
  is_primary: boolean;
}
export interface LocationPermissionPromptedPayload {
  context: "onboarding" | "discover" | "availability";
}
export interface LocationPermissionGrantedPayload {
  context: "onboarding" | "discover" | "availability";
}
export interface LocationPermissionDeniedPayload {
  context: "onboarding" | "discover" | "availability";
}
export interface FirstAvailabilityStartedPayload {
  duration_minutes: number;
}

// ---- Availability ----
export interface AvailabilityStartedPayload {
  duration_minutes: number;
  intent_count: number;
  trigger: "manual" | "scheduled" | "onboarding";
}
export interface AvailabilityExtendedPayload {
  additional_minutes: number;
}
export interface AvailabilityEndedPayload {
  reason: "manual" | "expired" | "extended_max";
}
export interface AvailabilityExpiredPayload {
  duration_minutes: number;
}
export interface MatchPreviewShownPayload {
  count: number;
}

// ---- Discovery ----
export interface FeedViewedPayload {
  tab: string;
  expansion_stage: number;
  result_count: number;
}
export interface MatchCardImpressedPayload {
  expansion_stage: number;
  position: number;
}
export interface MatchCardExpandedPayload {
  position: number;
}
export interface MatchExplainedPayload {
  score_band: string;
}
export interface MatchSkippedPayload {
  reason: string;
}
export interface EmptyStateShownPayload {
  reason: "no_supply" | "all_filtered" | "all_seen" | "profile_incomplete";
}

// ---- Connection ----
export interface RequestComposerOpenedPayload {
  source: "match_card" | "profile";
}
export interface IcebreakerUsedPayload {
  type: "specific_observation" | "shared_context" | "direct_ask";
}
export interface RequestSentPayload {
  has_note: boolean;
  ai_drafted: boolean;
}
export interface RequestThrottledPayload {
  queued_count: number;
}
export interface RequestReceivedPayload {
  match_score_band: string;
}
export interface RequestAcceptedPayload {
  latency_bucket: string;
}
export interface RequestRejectedPayload {
  latency_bucket: string;
}
export interface RequestExpiredPayload {
  had_been_viewed: boolean;
}
export interface QuotaExhaustedPayload {
  quota: "daily_requests" | "active_intents";
}

// ---- Messaging ----
export interface ConversationCreatedPayload {
  source: "request_accepted";
}
export interface MessageSentPayload {
  type: "text" | "voice" | "media";
  length_bucket: "short" | "medium" | "long";
  is_first: boolean;
}
export interface MessageDeliveredPayload {
  latency_bucket: string;
}
export interface MessageReadPayload {
  latency_bucket: string;
}
export interface ReplyReceivedPayload {
  latency_bucket: string;
}
export interface ConversationDepthReachedPayload {
  depth: 6 | 10 | 20;
}
export interface VoiceNoteSentPayload {
  duration_bucket: "short" | "medium" | "long";
}
export interface MediaSentPayload {
  media_type: "image" | "video";
}

// ---- AI ----
export interface AiFeatureInvokedPayload {
  feature: string;
  cache_hit: boolean;
  latency_bucket: string;
  quota_remaining: number;
}
export interface AiSuggestionAcceptedPayload {
  feature: string;
}
export interface AiSuggestionEditedPayload {
  feature: string;
}
export interface AiSuggestionRejectedPayload {
  feature: string;
}
export interface AiQuotaExhaustedPayload {
  feature: string;
}
export interface AiFailedPayload {
  feature: string;
  reason: "timeout" | "circuit_open" | "output_rejected" | "quota" | "unknown";
}

// ---- Monetisation ----
export interface PaywallShownPayload {
  trigger: string;
}
export interface PlanViewedPayload {
  plan: "premium";
}
export interface CheckoutStartedPayload {
  plan: "premium";
  billing_period: "monthly" | "annual";
}
export interface TrialStartedPayload {
  plan: "premium";
}
export interface SubscriptionCreatedPayload {
  plan: "premium";
  billing_period: "monthly" | "annual";
}
export interface SubscriptionRenewedPayload {
  plan: "premium";
}
export interface SubscriptionCanceledPayload {
  reason: string;
}
export interface PaymentFailedPayload {
  reason: string;
}

// ---- Safety ----
export interface UserBlockedPayload {
  source: "profile" | "conversation" | "match_card";
}
export interface ReportFiledPayload {
  category:
    | "child_safety"
    | "threats_violence"
    | "harassment_hate"
    | "scam_fraud"
    | "sexual_content"
    | "impersonation"
    | "spam"
    | "other";
}
export interface ModerationActionAppliedPayload {
  action: "notice" | "warning" | "throttle" | "shadow_limit" | "suspend" | "ban";
}
export interface AppealFiledPayload {
  original_action: string;
}
export interface ToxicityNudgeShownPayload {
  label: string;
}
export interface ToxicityNudgeHeededPayload {
  label: string;
}

// ---- Technical ----
export interface ApiErrorPayload {
  code: string;
  status: number;
}
export interface WsDisconnectedPayload {
  code: number | null;
}
export interface WsReconnectedPayload {
  duration_ms: number;
}
export interface OfflineModeEnteredPayload {
  screen: string;
}
export interface OutboxReplayedPayload {
  replayed_count: number;
  failed_count: number;
}
export interface WebVitalRecordedPayload {
  metric: "LCP" | "INP" | "CLS" | "FCP" | "TTFB";
  value_ms: number;
  route: string;
}

// PRD §21.2: "a tracking call that does not match a registered schema
// fails the type check." This interface IS the registry — track()
// (track.ts) is generic over `keyof EventRegistry`, so an event name not
// listed here, or a payload shape that doesn't structurally match, is a
// compile error at the call site, not a runtime surprise.
export interface EventRegistry {
  // Acquisition
  landing_viewed: Record<string, never>;
  signup_started: SignupStartedPayload;
  signup_step_completed: SignupStepCompletedPayload;
  signup_completed: SignupCompletedPayload;
  verification_completed: VerificationCompletedPayload;
  oauth_used: OauthUsedPayload;

  // Onboarding
  wizard_step_viewed: WizardStepViewedPayload;
  wizard_step_completed: WizardStepCompletedPayload;
  wizard_step_skipped: WizardStepSkippedPayload;
  intent_selected: IntentSelectedPayload;
  location_permission_prompted: LocationPermissionPromptedPayload;
  location_permission_granted: LocationPermissionGrantedPayload;
  location_permission_denied: LocationPermissionDeniedPayload;
  first_availability_started: FirstAvailabilityStartedPayload;

  // Availability
  availability_started: AvailabilityStartedPayload;
  availability_extended: AvailabilityExtendedPayload;
  availability_ended: AvailabilityEndedPayload;
  availability_expired: AvailabilityExpiredPayload;
  match_preview_shown: MatchPreviewShownPayload;

  // Discovery
  feed_viewed: FeedViewedPayload;
  match_card_impressed: MatchCardImpressedPayload;
  match_card_expanded: MatchCardExpandedPayload;
  match_explained: MatchExplainedPayload;
  match_skipped: MatchSkippedPayload;
  empty_state_shown: EmptyStateShownPayload;

  // Connection
  request_composer_opened: RequestComposerOpenedPayload;
  icebreaker_used: IcebreakerUsedPayload;
  request_sent: RequestSentPayload;
  request_throttled: RequestThrottledPayload;
  request_received: RequestReceivedPayload;
  request_accepted: RequestAcceptedPayload;
  request_rejected: RequestRejectedPayload;
  request_expired: RequestExpiredPayload;
  quota_exhausted: QuotaExhaustedPayload;

  // Messaging
  conversation_created: ConversationCreatedPayload;
  message_sent: MessageSentPayload;
  message_delivered: MessageDeliveredPayload;
  message_read: MessageReadPayload;
  reply_received: ReplyReceivedPayload;
  conversation_depth_reached: ConversationDepthReachedPayload;
  voice_note_sent: VoiceNoteSentPayload;
  media_sent: MediaSentPayload;

  // AI
  ai_feature_invoked: AiFeatureInvokedPayload;
  ai_suggestion_accepted: AiSuggestionAcceptedPayload;
  ai_suggestion_edited: AiSuggestionEditedPayload;
  ai_suggestion_rejected: AiSuggestionRejectedPayload;
  ai_quota_exhausted: AiQuotaExhaustedPayload;
  ai_failed: AiFailedPayload;

  // Monetisation
  paywall_shown: PaywallShownPayload;
  plan_viewed: PlanViewedPayload;
  checkout_started: CheckoutStartedPayload;
  trial_started: TrialStartedPayload;
  subscription_created: SubscriptionCreatedPayload;
  subscription_renewed: SubscriptionRenewedPayload;
  subscription_canceled: SubscriptionCanceledPayload;
  payment_failed: PaymentFailedPayload;

  // Safety
  user_blocked: UserBlockedPayload;
  report_filed: ReportFiledPayload;
  moderation_action_applied: ModerationActionAppliedPayload;
  appeal_filed: AppealFiledPayload;
  toxicity_nudge_shown: ToxicityNudgeShownPayload;
  toxicity_nudge_heeded: ToxicityNudgeHeededPayload;

  // Technical
  api_error: ApiErrorPayload;
  ws_disconnected: WsDisconnectedPayload;
  ws_reconnected: WsReconnectedPayload;
  offline_mode_entered: OfflineModeEnteredPayload;
  outbox_replayed: OutboxReplayedPayload;
  web_vital_recorded: WebVitalRecordedPayload;
}

export type EventName = keyof EventRegistry;

// §21.2: "No message content, no coordinates, and no profile free-text
// ever enter analytics." A structural, compile-time guarantee over
// EVERY payload in the registry above — not just the ones that happen
// to share a field name, which is why this uses a *distributive*
// conditional (`T extends unknown ? ... : never`) rather than a bare
// `keyof` over the union: `keyof (A | B)` is the *intersection* of A's
// and B's keys in TypeScript (only property names safe to access on
// either member without narrowing), so a naive `Extract<keyof (A|B),
// Denied>` would only catch a denied field if it appeared on literally
// every payload type at once — silently missing a single interface
// with a `body` or `coordinates` field. Distributing first (checking
// each union member individually, then unioning the results) is what
// actually catches a leak on any one event's payload.
type DistributedDeniedKeysOf<T> = T extends unknown
  ? Extract<keyof T, DeniedAnalyticsPayloadKeys>
  : never;
type AnyPayloadHasDeniedKey = DistributedDeniedKeysOf<EventRegistry[EventName]>;

type AssertNoDeniedFieldsAnywhere<T extends never> = T;
// If any event payload above ever grows a `body`, `coordinates`, or
// other denied field, `AnyPayloadHasDeniedKey` stops being `never` and
// this line — and therefore the whole package — fails to compile.
export type _NoDeniedAnalyticsFieldsReachable =
  AssertNoDeniedFieldsAnywhere<AnyPayloadHasDeniedKey>;
