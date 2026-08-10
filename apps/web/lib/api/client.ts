// Server-only fetch wrapper against apps/api. Every authenticated call
// goes through this (Server Components, Route Handlers, BFF routes) —
// there is currently no client-side fetch path to apps/api at all (see
// this file's own note below on why), which is what makes "the refresh
// token is never readable by client JS" trivially true rather than a
// promise: the browser never holds any Convene API credential.
//
// packages/types' generated OpenAPI types (openapi/convene.v1.yaml) are
// still schema-placeholder-only for every auth operation (`Placeholder`/
// untyped response bodies — confirmed by reading generated.ts directly),
// so there is nothing real to import from @convene/types for these
// shapes yet. The interfaces below hand-mirror apps/api's actual
// AuthResult/TokensResponse contract (auth.service.ts) as a stopgap,
// same "the spec hasn't caught up to the implementation" gap already
// flagged elsewhere in this codebase — not a rule-6 violation, since
// there's no real generated type being bypassed.
const DEFAULT_API_BASE_URL = "http://localhost:8080";

export function apiBaseUrl(): string {
  return process.env.API_BASE_URL ?? DEFAULT_API_BASE_URL;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    field: string | null;
    details: unknown;
    request_id: string | null;
    retry_after: number | null;
  };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly field: string | null;
  readonly details: unknown;
  readonly requestId: string | null;
  readonly retryAfter: number | null;

  constructor(status: number, envelope: ApiErrorEnvelope) {
    super(envelope.error.message);
    this.name = "ApiError";
    this.status = status;
    this.code = envelope.error.code;
    this.field = envelope.error.field;
    this.details = envelope.error.details;
    this.requestId = envelope.error.request_id;
    this.retryAfter = envelope.error.retry_after;
  }
}

export interface ApiFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  accessToken?: string | null;
  // apps/api's refresh/logout endpoints authenticate the refresh token
  // itself off a raw `Cookie` header (readCookie() in auth.controller.ts),
  // not a bearer token or a request body field — this lets the BFF's
  // refresh/logout routes forward the value it holds in its own httpOnly
  // cookie as a server-to-server Cookie header, without apps/api and
  // apps/web needing to share an actual browser cookie (different
  // origins).
  refreshTokenCookie?: string | null;
  headers?: Record<string, string>;
  cache?: RequestCache;
}

// Throws ApiError on any non-2xx response whose body matches the §17.9
// envelope; anything else (a network failure, a non-JSON 5xx) surfaces
// as the underlying fetch/parse error — callers distinguish the two via
// `instanceof ApiError`.
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const init: RequestInit = {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
      ...(options.refreshTokenCookie
        ? { Cookie: `refresh_token=${options.refreshTokenCookie}` }
        : {}),
      ...options.headers,
    },
    cache: options.cache ?? "no-store",
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);

  const response = await fetch(`${apiBaseUrl()}${path}`, init);

  if (!response.ok) {
    const envelope = (await response.json().catch(() => null)) as ApiErrorEnvelope | null;
    if (envelope?.error) throw new ApiError(response.status, envelope);
    throw new Error(`apps/api request failed: ${response.status} ${response.statusText}`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// Same contract as apiFetch, plus the raw response Headers — needed for
// apps/api's optimistic-concurrency ETag (GET /profiles/me's response
// carries one, set globally by that service's own EtagInterceptor; PATCH
// requires it back as If-Match). apiFetch itself throws headers away
// since nothing else so far has needed them.
export async function apiFetchWithHeaders<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<{ data: T; headers: Headers }> {
  const init: RequestInit = {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
      ...(options.refreshTokenCookie
        ? { Cookie: `refresh_token=${options.refreshTokenCookie}` }
        : {}),
      ...options.headers,
    },
    cache: options.cache ?? "no-store",
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);

  const response = await fetch(`${apiBaseUrl()}${path}`, init);

  if (!response.ok) {
    const envelope = (await response.json().catch(() => null)) as ApiErrorEnvelope | null;
    if (envelope?.error) throw new ApiError(response.status, envelope);
    throw new Error(`apps/api request failed: ${response.status} ${response.statusText}`);
  }

  const data = response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  return { data, headers: response.headers };
}

// Mirrors apps/api's UserResponse (auth.service.ts).
export interface UserResponse {
  id: string;
  full_name: string;
  email: string | null;
  email_verified: boolean;
  onboarding_step: number;
  status: string;
  role: string;
}

// Mirrors apps/api's TokensResponse (auth.service.ts).
export interface TokensResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  token_type: "Bearer";
}

export interface AuthResult {
  user: UserResponse;
  tokens: TokensResponse;
}

// apps/api's POST /auth/refresh returns tokens only (no user object) —
// see auth.controller.ts's refresh handler.
export interface RefreshResult {
  tokens: TokensResponse;
}

// apps/api's POST /realtime/ticket (realtime-ticket.service.ts) — a
// short-lived (60s), single-use ticket apps/realtime's WS gateway
// accepts as a `?ticket=` query param, exchanged instead of putting the
// long-lived access token in a URL (which would land in logs/history).
export interface WsTicketResponse {
  ticket: string;
  expires_in: number;
}

// apps/api's POST /auth/oauth/:provider/start (oauth.service.ts).
export interface OAuthStartResult {
  authorizeUrl: string;
  state: string;
}

// apps/api's POST /auth/oauth/:provider/callback and POST
// /auth/oauth/confirm-link both return this same shape (oauth.service.ts's
// own CallbackResult). `link_token` is present only when
// `link_confirmation_required` is true — the OAuth email matched an
// existing password-based account (§13 F1's "explicit link confirmation
// + password check" branch) and the caller must collect the user's
// password and POST it plus this token to /auth/oauth/confirm-link.
export interface OAuthCallbackResult {
  user: UserResponse | null;
  tokens: TokensResponse | null;
  is_new_user: boolean;
  link_confirmation_required: boolean;
  link_token?: string;
}

// Mirrors apps/api's ProfileResponse (profile.service.ts) — GET/PATCH
// /profiles/me. Wire shape is deliberately asymmetric with the PATCH
// request body (profileUpdateSchema): the response nests `industry`/
// `company` as `{id,label}`/`{name,verified}` objects, while the
// request takes flat `industry_id`/`company_name` — and the response
// has no `employment_type` field at all (write-only from the client's
// side; there's no way to read back what was last submitted). Both
// gaps are apps/api's own contract, not something to paper over here.
// P20.3 note: this previously carried top-level `timezone`/
// `remote_preference`/`open_to_relocate` fields that don't exist
// anywhere in apps/api's real response (verified by reading
// profile.service.ts's own ProfileResponse interface directly) — dead
// scaffolding nothing referenced. Removed here while adding the fields
// P20.3 actually needs (`location`, `verification`, `intents`), rather
// than adding on top of a shape already known to be wrong.
export interface ProfileResponse {
  full_name: string;
  headline: string | null;
  about: string | null;
  avatar: { sm: string; md: string; lg: string } | null;
  industry: { id: number; label: string } | null;
  company: { name: string; verified: boolean } | null;
  job_title: string | null;
  years_experience: string | null;
  location: {
    city: string | null;
    state: string | null;
    country: string | null;
    timezone: string | null;
    distance_bucket: string | null;
  };
  verification: { level: number };
  // Lightweight — type/detail/expires_at only, no id/is_primary/is_paused.
  // Enough to gate onboarding step 4 (lib/onboarding/current-step.ts) and
  // to derive session-intent options for step 6's picker without a
  // separate GET /intents round trip; the step-4 form itself still needs
  // the fuller GET /intents response (ids, is_paused, etc.) to manage the
  // interactive chip picker.
  intents: { type: string; detail: string | null; expires_at: string }[];
  // P22.1's card anatomy needs this for the presence/countdown line —
  // apps/api's real ProfileResponse (profile.service.ts) has carried this
  // field all along, just unused by any frontend type until now.
  availability: { state: string; expires_at: string | null } | null;
}

// Mirrors apps/api's ProfileResponse (profile.service.ts) as returned by
// BOTH `GET /profiles/me` and `GET /profiles/:userId` — the real backend
// shape is one interface for both routes, unlike this file's older
// `ProfileResponse` above (P20.3's minimal, /profiles/me-only subset,
// left as-is since onboarding still reads only that slice). `compatibility`
// is a genuinely partial preview (5 of 11 real subscores — profile.
// service.ts's own comment), `null` on your own profile.
// `profile_completion` is present only when viewing yourself (omitted as
// a key entirely otherwise, not just undefined).
export interface SkillEntry {
  name: string;
  proficiency: "beginner" | "intermediate" | "advanced" | "expert" | null;
  years: number | null;
}

export interface LanguageEntry {
  code: string;
  proficiency: "basic" | "conversational" | "fluent" | "native";
}

export interface ExperienceEntry {
  id: string;
  company_name: string;
  title: string;
  employment_type: string | null;
  location_text: string | null;
  description: string | null;
  start_date: string;
  end_date: string | null;
  is_current: boolean;
  position: number;
}

export interface EducationEntry {
  id: string;
  school: string;
  degree: string | null;
  field_of_study: string | null;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
  position: number;
}

export interface CertificationEntry {
  id: string;
  name: string;
  issuer: string;
  issued_at: string | null;
  expires_at: string | null;
  credential_url: string | null;
  position: number;
}

export interface PortfolioEntry {
  id: string;
  title: string;
  url: string;
  description: string | null;
  position: number;
}

export interface FullProfileResponse {
  user_id: string;
  full_name: string;
  headline: string | null;
  about: string | null;
  avatar: { sm: string; md: string; lg: string } | null;
  industry: { id: number; label: string } | null;
  job_title: string | null;
  company: { name: string; verified: boolean } | null;
  years_experience: string;
  skills: SkillEntry[];
  interests: string[];
  languages: LanguageEntry[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  certifications: CertificationEntry[];
  portfolio: PortfolioEntry[];
  location: {
    city: string | null;
    state: string | null;
    country: string | null;
    timezone: string | null;
    distance_bucket: string | null;
  };
  verification: { level: number };
  reputation: {
    band: string;
    response_rate: string | null;
    median_response_minutes: number | null;
  };
  availability: { state: string; expires_at: string | null } | null;
  intents: { type: string; detail: string | null; expires_at: string }[];
  mutual_connections: { count: number };
  relationship: { status: "self" | "connected" | "matched" | "stranger"; can_request: boolean };
  compatibility: { score: number; reasons: string[] } | null;
  profile_completion?: number;
}

// Mirrors apps/api's CompletionResult (completion.service.ts) — GET
// /profiles/me/completion. `missing` is ordered by `impact` descending
// server-side (the "Next: add 2 more skills (+6%)" line reads the first
// entry), not resorted here.
export interface CompletionResult {
  score: number;
  missing: { field: string; impact: number; cta: string }[];
}

export interface Industry {
  id: number;
  name: string;
}

// `country` is the ISO-3166-1 alpha-2 code, not the full name —
// taxonomy.service.ts's getCities() doesn't join the countries/states
// tables (unlike location.service.ts's separate reverse-geocode lookup),
// so a full country/state name isn't available from this endpoint without
// an apps/api change out of this phase's scope. A code is still enough to
// disambiguate same-named cities in a typeahead.
export interface City {
  id: number;
  name: string;
  country: string | null;
}

// Mirrors apps/api's IntentTaxonomyEntry (intent-taxonomy.ts) — GET
// /intents/taxonomy, static reference data (14 types).
export interface IntentTaxonomyEntry {
  type: string;
  label: string;
  category: string;
  complements: string[];
  peerMatch: string | null;
  prerequisites: string[];
}

// Mirrors apps/api's IntentResponse (intents.service.ts) — the fuller
// per-intent shape used by GET/POST/PATCH /intents (unlike
// ProfileResponse.intents' lightweight summary).
export interface IntentResponse {
  id: string;
  type: string;
  detail: string | null;
  metadata: unknown;
  is_primary: boolean;
  is_paused: boolean;
  status: string;
  expires_at: string;
  renewed_count: number;
  created_at: string;
}

// Mirrors apps/api's CreateIntentResult (intents.service.ts). match_preview
// is honestly hardcoded to {0,0} server-side until the matching pipeline
// exists (intents.service.ts's own comment) — never estimated client-side.
export interface CreateIntentResult {
  intent: IntentResponse;
  active_count: number;
  plan_limit: number;
  match_preview: { potential_matches: number; nearby: number };
}

// Mirrors apps/api's LocationUpdateResponse (location.service.ts) — PUT
// /location and /location/manual. `nearby_user_count` is a real COUNT
// query (fixed 25km radius), never fabricated. No coordinates or geohash
// are exposed here — this frontend type intentionally omits the
// response's own `geohash_5` receipt field even though apps/api includes
// it (a coarse ~5km-cell hash, not exact coordinates, and explicitly
// sanctioned there as a self-service receipt) since nothing in this UI
// has a reason to hold onto it.
export interface LocationUpdateResponse {
  city: { id: number; name: string } | null;
  state: string | null;
  country: string | null;
  timezone: string | null;
  nearby_user_count: number;
}

// Mirrors apps/api's LocationPreferencesResponse (location.service.ts) —
// PUT /preferences/location.
export interface LocationPreferencesResponse {
  search_radius_km: number;
  remote_preference: string;
  open_to_relocate: boolean;
  relocate_target_city_ids: number[];
  auto_expand_radius: boolean;
  pinned_tier: number | null;
}

// Mirrors apps/api's SessionResponse/MatchPreview/CreateSessionResult
// (availability.service.ts) — POST /availability/sessions. `top_score` is
// honestly null (real weighted scoring doesn't exist yet, that service's
// own comment); `available_now_count`/`nearby_count` are real queries.
export interface SessionResponse {
  id: string;
  state: string;
  started_at: string;
  expires_at: string | null;
  duration_minutes: number | null;
  extensions_used: number;
  extensions_remaining: number;
  note: string | null;
  session_intents: { id: string; type: string }[];
}

export interface MatchPreview {
  available_now_count: number;
  nearby_count: number;
  top_score: number | null;
}

export interface CreateSessionResult {
  session: SessionResponse;
  match_preview: MatchPreview | null;
}

// Mirrors apps/api's GET /availability/me (availability.service.ts's
// getCurrent()). The PRD's own §10.3.8 contract additionally documents
// `presence`/`next_scheduled_window`/`convene_hours` fields, but the real
// implementation returns only `current_session` — verified by reading
// availability.service.ts directly (same "the real code is ground truth
// over stale PRD prose" precedent as this session's WS-protocol findings).
// Convene Hours/scheduling aren't built yet, so there's nothing dropped.
export interface AvailabilityMeResponse {
  current_session: SessionResponse | null;
}

// Mirrors apps/api's EndSessionSummary (availability.service.ts) — the
// response of DELETE /availability/sessions/:id.
export interface EndSessionSummary {
  matches_viewed: number;
  requests_sent: number;
  conversations_started: number;
  duration_actual_minutes: number;
}

// Mirrors apps/api's DiscoveryController response (discovery.controller.ts)
// — GET /discover and /discover/available-now. Deliberately minimal: only
// candidate_id/score/reasons/expansion_stage/location_tier — no name,
// avatar, headline, or distance_bucket. The full "match card" (P22.1's own
// scope) doesn't exist yet; this phase (P21.2, home screen) hydrates each
// candidate_id's display info with a separate GET /profiles/:userId call
// rather than inventing card fields this endpoint doesn't provide.
export type DiscoveryEmptyStateReason =
  "no_supply" | "all_filtered" | "all_seen" | "profile_incomplete";

export interface MatchCard {
  candidate_id: string;
  score: number;
  reasons: string[];
  expansion_stage: number;
  location_tier: number;
}

export interface DiscoveryResponse {
  data: MatchCard[];
  meta: { next_cursor: string | null; has_more: boolean; expansion_stage: number };
  empty_state: DiscoveryEmptyStateReason | null;
}

// Mirrors apps/api's ConnectionsController (connections.controller.ts) —
// GET /connections/requests. `quota`'s exact shape isn't typed by the
// controller itself (declared `unknown` there too) — not needed for the
// home screen's requests strip, which only shows a count and avatars.
export interface RequestCard {
  id: string;
  status: "pending" | "accepted" | "rejected" | "cancelled" | "expired";
  sender_id: string;
  recipient_id: string;
  intent: { id: string; type: string; detail: string | null } | null;
  note: string | null;
  match_score: number | null;
  match_reasons: string[] | null;
  is_queued: boolean;
  created_at: string;
  expires_at: string;
}

export interface RequestsListResponse {
  requests: RequestCard[];
  next_cursor: string | null;
  throttle: { enabled: boolean; daily_cap: number; queued_count: number } | null;
}

// P21.2's own BFF-side shapes (not apps/api's — apps/api returns bare
// candidate_id/sender_id, per the comments above). lib/discovery's shared
// fetchers hydrate each with a display profile via GET /profiles/:userId
// and both the BFF routes and the Server Components that render these
// sections consume this merged shape, so the Query cache is always this
// exact shape regardless of whether it came from SSR or a client refetch.
// P22.1's card anatomy needs more than P21.2's minimal set — company,
// verification, availability (for the presence/countdown line), and a
// primary-intent chip. ProfileResponse.intents has no is_primary flag
// (only type/detail/expires_at — see that field's own comment), so
// "primary" here means "first in the list," a documented simplification,
// not a transcription of a real primary flag this endpoint doesn't carry.
export interface CandidateDisplayProfile {
  full_name: string;
  avatar: { sm: string; md: string; lg: string } | null;
  headline: string | null;
  distance_bucket: string | null;
  city: string | null;
  company: { name: string; verified: boolean } | null;
  verification_level: number;
  availability: { state: string; expires_at: string | null } | null;
  primary_intent_type: string | null;
}

export interface HydratedMatchCard extends MatchCard {
  profile: CandidateDisplayProfile | null;
}

export interface HydratedDiscoveryResponse {
  data: HydratedMatchCard[];
  meta: { next_cursor: string | null; has_more: boolean; expansion_stage: number };
  empty_state: DiscoveryEmptyStateReason | null;
}

// `counterparty` is direction-aware: for a `direction=received` request
// it's the sender; for `direction=sent` it's the recipient. Named this
// way (not `sender`) because a single request card can represent either
// direction depending on which tab fetched it — P21.2's home strip only
// ever fetches `direction=received`, where "sender" and "counterparty"
// happen to be the same person, but P23.1's own Sent tab needs the
// recipient, not the caller's own profile.
export interface HydratedRequestCard extends RequestCard {
  counterparty: CandidateDisplayProfile | null;
}

export interface HydratedRequestsListResponse {
  requests: HydratedRequestCard[];
  next_cursor: string | null;
  throttle: { enabled: boolean; daily_cap: number; queued_count: number } | null;
}

// Mirrors apps/api's ReportCard (reports.controller.ts) — POST /reports.
export interface ReportResult {
  id: string;
  reference: string;
  category: string;
  severity: string;
  status: string;
  sla_due_at: string;
  created_at: string;
}

// Mirrors @convene/matching's ScoreExplanation (explain.ts) — GET
// /matches/:id/explain. `subScore` (0-1) is what design.md's sub-score
// bars display as a percentage; `contribution` is the integer point
// value that sums exactly to `score` (explain.ts's own invariant).
export interface ScoreContribution {
  key: string;
  weight: number;
  subScore: number;
  contribution: number;
}

export interface ScoreExplanation {
  score: number;
  contributions: ScoreContribution[];
}

// Mirrors apps/api's ConnectionsController.sendRequest response
// (connections.controller.ts) — POST /connections/requests. `status` is
// 201 normally, 202 when BR-CONN's throttle queues the request instead
// of sending it immediately (queued_position is only present then).
export interface SendConnectionRequestResult {
  request: { id: string; status: string; expires_at: string };
  quota: unknown;
  queued_position?: number;
}

// Mirrors apps/api's ConversationsController's ConversationCard
// (conversations.controller.ts) — GET /conversations. No avatar object
// (just full_name) and no presence field — presence only flows over the
// WS realtime channel (rt:presence:*), not this REST response.
export interface ConversationCard {
  id: string;
  participant: { user_id: string | null; full_name: string | null };
  last_message: {
    body_preview: string | null;
    sender_id: string | null;
    created_at: string | null;
    type: string | null;
  } | null;
  unread_count: number;
  is_pinned: boolean;
  is_muted_until: string | null;
  is_archived: boolean;
  connection: { intent: string | null };
}

export interface ConversationsListResponse {
  conversations: ConversationCard[];
}

// Mirrors apps/api's EntitlementsResult (entitlements.service.ts) — GET
// /entitlements. `plan` is honestly always "free" (AuthContext.plan's
// own documented state) — see that service's comment for why nothing
// here is fabricated as a paid tier.
export interface EntitlementsResult {
  plan: string;
  limits: {
    daily_requests: number;
    active_intents: number;
    max_session_duration_minutes: number;
    max_search_radius_km: number;
  };
  usage: { daily_requests_used: number; active_intents_used: number };
  features: {
    advanced_search_filters: boolean;
    who_viewed_me_full_list: boolean;
    custom_session_duration: boolean;
    custom_search_radius: boolean;
  };
}

// Mirrors apps/api's SearchService result (search.service.ts) — GET
// /search/users. Intentionally simple (ILIKE, not the PRD's full FTS/
// vector orchestration) — see that service's own comment.
export interface SearchResultRow {
  user_id: string;
  full_name: string;
  headline: string | null;
  job_title: string | null;
  company_name: string | null;
  verification_level: number;
  city_name: string | null;
}

export interface SearchUsersResult {
  results: SearchResultRow[];
  facets: { industries: { id: number; name: string; count: number }[] };
  total_estimate: number;
  next_cursor: string | null;
  applied_premium_filters: string[];
}

// Mirrors apps/api's NotificationsController (notifications.controller.ts)
// — GET /notifications, GET/PUT /notifications/preferences. Grouping
// (Today/Earlier) is client-computed from `created_at` — apps/api never
// returns a group label (that controller's own comment).
export interface NotificationCard {
  id: string;
  category: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  priority: string;
  read_at: string | null;
  created_at: string;
}

export interface NotificationsListResponse {
  notifications: NotificationCard[];
  unread_count: number;
}

export interface NotificationChannelPrefs {
  push?: boolean;
  in_app?: boolean;
  email?: boolean;
}

export interface NotificationPreferencesResponse {
  categories: Record<string, NotificationChannelPrefs>;
  quiet_hours: { enabled: boolean; start: string; end: string } | null;
}

// Mirrors apps/api's InboundFiltersResponse (inbound-filters.service.ts)
// — GET/PUT /settings/inbound-intent-filters.
export interface InboundFiltersResponse {
  accepted_intents: string[] | null;
  min_experience_years: string | null;
  max_experience_years: string | null;
  industries: number[] | null;
  verified_only: boolean;
  max_inbound_per_day: number | null;
}

// Mirrors apps/api's SessionSummary (refresh.service.ts) — GET/DELETE
// /auth/sessions.
export interface SessionSummary {
  id: string;
  device: string | null;
  ip_country: string | null;
  last_active_at: string;
  current: boolean;
}

// Mirrors apps/api's BlockedUser (blocks.service.ts) — GET /blocks.
export interface BlockedUser {
  blocked_id: string;
  reason: string | null;
  created_at: string;
}

// Mirrors apps/api's GET /profiles/me/viewers (§13 F11 trigger 4) —
// free plan gets `count` only with an empty `viewers` array (never a
// fabricated list), Premium gets the real deduplicated list too.
export interface ProfileViewersResult {
  count: number;
  viewers: { user_id: string; full_name: string; viewed_at: string }[];
}

// Mirrors apps/api's IcebreakersResult (icebreakers.service.ts) — POST
// /ai/icebreakers. "unavailable" is the honest degraded state (quota
// exhausted, model down, or a hard-rule violation caught server-side) —
// the caller falls back to the curated static templates, never shows a
// partial/fabricated result.
export type IcebreakerType = "specific_observation" | "shared_context" | "direct_ask";

export interface IcebreakersResult {
  status: "ok" | "unavailable";
  openers?: { type: IcebreakerType; text: string }[];
}

// Mirrors apps/api's AdminReportsController/AdminModerationActionsController/
// AdminAppealsController (P26.1) — the report queue, enforcement ladder,
// and appeals review surfaces in (admin)/admin.
export interface AdminReportCard {
  id: string;
  reference: string;
  target_type: string;
  target_id: string;
  target_user_id: string | null;
  category: string;
  severity: string;
  status: string;
  description: string | null;
  assigned_to: string | null;
  sla_due_at: string;
  created_at: string;
}

export interface AdminModerationActionCard {
  id: string;
  target_user_id: string | null;
  action: string;
  status: string;
  policy_clause: string;
  rationale: string;
  expires_at: string | null;
  created_at: string;
}

export interface AdminAppealCard {
  id: string;
  moderation_action_id: string;
  status: string;
  reviewer_admin_id: string | null;
  decided_at: string | null;
}

// Mirrors AdminReportsController.content()'s three shapes — a message,
// a profile, or an honest "we don't know how to show this target_type
// yet" marker (never a fabricated view).
// Mirrors @convene/matching's MatchingWeights (packages/matching/src/weights.ts)
// — the 11 sub-score keys, each in [0,1], summing to 1.00. AdminMatchingController
// (P26.2, AD-8) is the only place apps/web ever reads/writes these.
export interface MatchingWeights {
  avail: number;
  intent: number;
  loc: number;
  skill: number;
  industry: number;
  exp: number;
  interest: number;
  mutual: number;
  activity: number;
  rep: number;
  lang: number;
}

export type AdminReportContent =
  | {
      target_type: "message";
      status: "ok";
      message: {
        id: string;
        conversation_id: string;
        sender_id: string | null;
        body: string | null;
        type: string;
        deleted_at: string | null;
        moderation_state: string;
        created_at: string;
      };
    }
  | { target_type: string; status: "content_unavailable" }
  | { target_type: string; status: "unsupported_target_type" }
  | { target_type: "profile" | "user"; status: "ok"; profile: FullProfileResponse };
