export type RateLimitKeyDimension = "user" | "ip" | "identifier" | "conversation";

export interface RateLimitPolicy {
  limit: number;
  windowSeconds: number;
  keyDimensions: readonly RateLimitKeyDimension[];
  notes: string;
}

// PRD §17.6 rate-limit matrix, transcribed as data — a controller names a
// policy via @RateLimit({ scope }), it never hand-types a limit or window.
// One entry per table row, split into multiple named policies wherever a
// row specifies more than one independent limit (e.g. "5/15min per
// identifier + 20/h per IP" is two separate sliding windows, both must
// pass).
//
// A few of the table's per-row qualifiers describe a genuinely different
// enforcement mechanism, not a request-count sliding window, and are
// deliberately NOT modelled here — flagged on the relevant policy below:
//   - "Burst 60" (global-authenticated): a sliding-window log already
//     permits up to `limit` requests within any window, which covers a
//     burst up to that ceiling; it does not implement token-bucket-style
//     "burst above the steady rate" semantics, which would need a
//     different algorithm. The PRD asks for one sliding-window mechanism
//     applied uniformly, so this is treated as informational rather than
//     separately enforced.
//   - connection-requests-velocity: only the 5/10min velocity cap is a
//     rate limit; the plan-based daily quota (8/30/120) is a plan
//     entitlement check owned by the connections/billing modules.
//   - messages-*: the 3-message monologue rule is a business rule owned
//     by the messaging module, not a rate limit.
//   - media-upload: the 200MB/day cap is a data-volume quota, not a
//     request-count limit — owned by the media pipeline.
//   - ai-features: per-feature quotas are owned by the ai-gateway module;
//     only the 20 calls/h hard cap is modelled here.
export const RATE_LIMIT_POLICIES = {
  "global-authenticated": {
    limit: 300,
    windowSeconds: 60,
    keyDimensions: ["user"],
    notes: "Burst 60 — see the sliding-window-vs-token-bucket comment above this table.",
  },
  unauthenticated: {
    limit: 60,
    windowSeconds: 60,
    keyDimensions: ["ip"],
    notes: "Signup/login paths use the tighter identifier/IP-scoped policies below instead.",
  },
  "login-attempts-identifier": {
    limit: 5,
    windowSeconds: 15 * 60,
    keyDimensions: ["identifier"],
    notes: "Then CAPTCHA, then a 15 min lock — enforced by the auth module, not this guard.",
  },
  "login-attempts-ip": {
    limit: 20,
    windowSeconds: 60 * 60,
    keyDimensions: ["ip"],
    notes: "",
  },
  "otp-send-hourly": {
    limit: 3,
    windowSeconds: 60 * 60,
    keyDimensions: ["identifier"],
    notes: "The 60s cooldown between sends is enforced by the OTP service (P5.2), not this guard.",
  },
  "otp-send-daily": {
    limit: 10,
    windowSeconds: 24 * 60 * 60,
    keyDimensions: ["identifier"],
    notes: "",
  },
  "password-reset": {
    limit: 3,
    windowSeconds: 60 * 60,
    keyDimensions: ["identifier"],
    notes: "Enumeration-safe responses are the auth module's responsibility, not this guard's.",
  },
  "connection-requests-velocity": {
    limit: 5,
    windowSeconds: 10 * 60,
    keyDimensions: ["user"],
    notes: "Plan-based daily quota (8/30/120) is a separate entitlement check, not modelled here.",
  },
  "messages-per-conversation": {
    limit: 60,
    windowSeconds: 60,
    keyDimensions: ["conversation"],
    notes: "The 3-message monologue rule is a separate business rule, not modelled here.",
  },
  "messages-per-user": {
    limit: 200,
    windowSeconds: 60,
    keyDimensions: ["user"],
    notes: "",
  },
  "discovery-feed": {
    limit: 120,
    windowSeconds: 60 * 60,
    keyDimensions: ["user"],
    notes: "Cached responses don't count — enforced by only invoking this guard on cache misses.",
  },
  "search-free": {
    limit: 60,
    windowSeconds: 60 * 60,
    keyDimensions: ["user"],
    notes:
      "Choosing search-free vs search-recruiter by the caller's plan is the calling route's job.",
  },
  "search-recruiter": {
    limit: 600,
    windowSeconds: 60 * 60,
    keyDimensions: ["user"],
    notes: "",
  },
  "media-upload": {
    limit: 30,
    windowSeconds: 60 * 60,
    keyDimensions: ["user"],
    notes: "The 200MB/day cap is a data-volume quota, not modelled here.",
  },
  "ai-features": {
    limit: 20,
    windowSeconds: 60 * 60,
    keyDimensions: ["user"],
    notes: "Per-feature quotas are owned by the ai-gateway module; this is only the hard cap.",
  },
  reports: {
    limit: 20,
    windowSeconds: 24 * 60 * 60,
    keyDimensions: ["user"],
    notes: "Abuse of reporting is itself actionable — enforced by trust-safety, not this guard.",
  },
  "admin-actions": {
    limit: 200,
    windowSeconds: 60 * 60,
    keyDimensions: ["user"],
    notes: "Anomaly-alerted — enforced by the admin module's own monitoring, not this guard.",
  },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitScope = keyof typeof RATE_LIMIT_POLICIES;
