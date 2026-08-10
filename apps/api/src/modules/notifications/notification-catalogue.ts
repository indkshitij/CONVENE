// PRD §10.8.1 — the 15-category catalogue, transcribed verbatim. Static
// reference data (no DB round trip), same shape as intent-taxonomy.ts.
export const NOTIFICATION_CATEGORIES = [
  "new_match_high",
  "connection_request",
  "request_accepted",
  "new_message",
  "availability_expiring",
  "availability_window_starting",
  "convene_hours_starting",
  "intent_expiring",
  "saved_search_alert",
  "profile_view",
  "weekly_digest",
  "reputation_change",
  "moderation_action",
  "security_alert",
  "plan_billing",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export type NotificationChannel = "push" | "in_app" | "email";

export type NotificationPriority = "low" | "medium" | "high" | "critical";

export interface NotificationCatalogueEntry {
  category: NotificationCategory;
  trigger: string;
  channels: readonly NotificationChannel[];
  /** "On (Premium)"/"On (opt-in users)" defaults are enforced by the trigger site (only fired for qualifying users), not here — this only says whether the category is on by default for a user it's triggered for at all. */
  defaultOn: boolean;
  collapsible: boolean;
  priority: NotificationPriority;
  /** BR-NOTIF-01: "moderation_action, security_alert and plan_billing cannot be disabled." */
  forcedOn: boolean;
}

export const NOTIFICATION_CATALOGUE: Record<NotificationCategory, NotificationCatalogueEntry> = {
  new_match_high: {
    category: "new_match_high",
    trigger: "New candidate scoring >= 80 while you're available",
    channels: ["push", "in_app"],
    defaultOn: true,
    collapsible: true,
    priority: "high",
    forcedOn: false,
  },
  connection_request: {
    category: "connection_request",
    trigger: "Inbound request",
    channels: ["push", "in_app", "email"],
    defaultOn: true,
    collapsible: true,
    priority: "high",
    forcedOn: false,
  },
  request_accepted: {
    category: "request_accepted",
    trigger: "Your request accepted",
    channels: ["push", "in_app", "email"],
    defaultOn: true,
    collapsible: false,
    priority: "high",
    forcedOn: false,
  },
  new_message: {
    category: "new_message",
    trigger: "Message received",
    channels: ["push", "in_app"],
    defaultOn: true,
    collapsible: false, // "Per conversation" — handled at the trigger site (one notification per conversation), not via the generic collapse mechanism.
    priority: "critical",
    forcedOn: false,
  },
  availability_expiring: {
    category: "availability_expiring",
    trigger: "T-5 min",
    channels: ["push", "in_app"],
    defaultOn: true,
    collapsible: false,
    priority: "medium",
    forcedOn: false,
  },
  availability_window_starting: {
    category: "availability_window_starting",
    trigger: "T-10 min before scheduled",
    channels: ["push"],
    defaultOn: true,
    collapsible: false,
    priority: "medium",
    forcedOn: false,
  },
  convene_hours_starting: {
    category: "convene_hours_starting",
    trigger: "T-15 min",
    channels: ["push"],
    defaultOn: true, // "On (opt-in users)" — only fired for users who opted into Convene Hours; the trigger site's responsibility, not a preference default.
    collapsible: false,
    priority: "low",
    forcedOn: false,
  },
  intent_expiring: {
    category: "intent_expiring",
    trigger: "T-3 days",
    channels: ["in_app", "email"],
    defaultOn: true,
    collapsible: true,
    priority: "low",
    forcedOn: false,
  },
  saved_search_alert: {
    category: "saved_search_alert",
    trigger: "Saved-search match goes available",
    channels: ["push", "in_app"],
    defaultOn: true, // "On (Premium)" — only ever triggered for Premium users; see trigger-site note above.
    collapsible: true,
    priority: "medium",
    forcedOn: false,
  },
  profile_view: {
    category: "profile_view",
    trigger: "Someone viewed your profile",
    channels: ["in_app", "push"], // "Push: Premium" — the trigger site only requests push for Premium users.
    defaultOn: true,
    collapsible: true,
    priority: "low",
    forcedOn: false,
  },
  weekly_digest: {
    category: "weekly_digest",
    trigger: "Weekly",
    channels: ["email"],
    defaultOn: true,
    collapsible: false,
    priority: "low",
    forcedOn: false,
  },
  reputation_change: {
    category: "reputation_change",
    trigger: "Band change",
    channels: ["in_app"],
    defaultOn: true,
    collapsible: false,
    priority: "low",
    forcedOn: false,
  },
  moderation_action: {
    category: "moderation_action",
    trigger: "Warning/restriction issued",
    channels: ["push", "in_app", "email"],
    defaultOn: true,
    collapsible: false,
    priority: "critical",
    forcedOn: true,
  },
  security_alert: {
    category: "security_alert",
    trigger: "New device login, password change, token reuse",
    channels: ["push", "email"],
    defaultOn: true,
    collapsible: false,
    priority: "critical",
    forcedOn: true,
  },
  plan_billing: {
    category: "plan_billing",
    trigger: "Payment failure, renewal, trial ending",
    channels: ["push", "in_app", "email"],
    defaultOn: true,
    collapsible: false,
    priority: "high",
    forcedOn: true,
  },
};

export function isNotificationCategory(value: string): value is NotificationCategory {
  return Object.hasOwn(NOTIFICATION_CATALOGUE, value);
}
