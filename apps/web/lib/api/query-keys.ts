// PRD §18.3: "Query keys are factory-generated (qk.conversation.messages(id))
// so invalidation is never a stringly-typed guess." Every key is a plain
// array (TanStack Query's own convention) built through one of these
// functions — nowhere else in the app should a query key be typed out by
// hand. Grouped by entity per §18.3's "server data" ownership table
// (profile, feed, conversations, messages, quotas, notifications) plus
// taxonomies, which the same section calls out with its own 5-minute
// staleTime.
export const qk = {
  profile: {
    me: () => ["profile", "me"] as const,
    byId: (userId: string) => ["profile", "byId", userId] as const,
  },
  feed: {
    home: () => ["feed", "home"] as const,
    discover: (filters?: Record<string, unknown>) => ["feed", "discover", filters ?? {}] as const,
  },
  match: {
    byId: (userId: string) => ["match", userId] as const,
  },
  // P23.1: parameterized so the Received/Sent tabs (and each sort mode)
  // cache separately rather than colliding on one shared entry — the
  // original no-arg list() (P19.2 scaffolding, only ever called with the
  // Home requests strip's implicit received/pending/score_desc) is now
  // this shape's default-valued call.
  requests: {
    list: (direction: "received" | "sent" = "received", status?: string, sort?: string) =>
      ["requests", "list", direction, status ?? null, sort ?? null] as const,
  },
  availability: {
    me: () => ["availability", "me"] as const,
  },
  conversation: {
    list: (filter: "all" | "unread" | "pinned" | "archived" = "all") =>
      ["conversation", "list", filter] as const,
    // The bare ["conversation","list"] prefix — TanStack Query's own
    // prefix-matching invalidates every list(filter) variant at once via
    // this, which is what a "a message arrived somewhere" realtime event
    // needs (it doesn't know which filter tabs are mounted).
    listPrefix: () => ["conversation", "list"] as const,
    detail: (conversationId: string) => ["conversation", "detail", conversationId] as const,
    messages: (conversationId: string) => ["conversation", "messages", conversationId] as const,
  },
  notifications: {
    list: () => ["notifications", "list"] as const,
    unreadCount: () => ["notifications", "unreadCount"] as const,
  },
  quotas: {
    all: () => ["quotas"] as const,
  },
  taxonomies: {
    byKind: (kind: string, query: string = "") => ["taxonomies", kind, query] as const,
  },
  // P26.1: (admin)/admin's report queue, ban-approval queue, and appeals
  // review queue.
  admin: {
    reports: (status?: string, severity?: string, category?: string) =>
      ["admin", "reports", status ?? null, severity ?? null, category ?? null] as const,
    reportContent: (reportId: string) => ["admin", "reportContent", reportId] as const,
    moderationActions: (status?: string) => ["admin", "moderationActions", status ?? null] as const,
    appeals: (status?: string) => ["admin", "appeals", status ?? null] as const,
    matchingWeights: () => ["admin", "matchingWeights"] as const,
  },
} as const;

// §18.3's per-entity staleTime overrides ("30s default, 5min for
// taxonomies, 0 for messages") — a lookup keyed by the query key's own
// first two segments, read by query-provider.tsx's `queryFn` default
// options via `staleTimeFor(queryKey)` so a new query type falls back to
// the 30s default instead of silently getting 0 if this table isn't
// updated in lockstep with query-keys.ts.
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const THIRTY_SECONDS_MS = 30 * 1000;

export function staleTimeFor(queryKey: readonly unknown[]): number {
  const [entity, sub] = queryKey;
  if (entity === "taxonomies") return FIVE_MINUTES_MS;
  if (entity === "conversation" && sub === "messages") return 0;
  // Admin queues are acted on directly (approve/apply/review) — always
  // refetch rather than risk a stale row driving an action.
  if (entity === "admin") return 0;
  return THIRTY_SECONDS_MS;
}
