import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

// The onboarding-wizard guard (lib/auth/guards.ts's requireOnboardingComplete)
// and the wizard page itself (app/(onboarding)/setup/[step]/page.tsx) both
// call apps/api directly, server-side, via lib/api/client.ts's apiFetch —
// this happens inside the Next server process, never in the browser, so
// Playwright's own page.route() (which only intercepts the browser's fetches)
// can't stand in for apps/api here the way it does for the BFF-route tests in
// auth-screens.spec.ts. This is a tiny real HTTP server standing in for the
// handful of apps/api endpoints the wizard touches, started once for the
// whole Playwright run (see playwright.config.ts's second webServer entry)
// with apps/web's API_BASE_URL pointed at it.
export interface MockIntent {
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

export interface MockSession {
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

export interface MockProfileState {
  full_name: string;
  headline: string | null;
  job_title: string | null;
  company: { name: string; verified: boolean } | null;
  industry: { id: number; label: string } | null;
  years_experience: string | null;
  location: {
    city: string | null;
    state: string | null;
    country: string | null;
    timezone: string | null;
    distance_bucket: string | null;
  };
  verification: { level: number };
  intents: MockIntent[];
  currentSession: MockSession | null;
  // Test-seedable knobs for the "honest numbers" acceptance criterion —
  // not part of apps/api's real profile shape, only this mock's own
  // config surface for controlling what the match-preview/count endpoints
  // return.
  nearbyUserCount: number;
  availableNowCount: number;
  planLimit: number;
  // P21.2 home-screen seedable knobs. discoverCandidates/
  // availableNowCandidates are lists of {id, score, reasons} — GET
  // /profiles/:id (a different route from GET /profiles/me) always
  // synthesizes a display profile for any id, so these lists don't need
  // matching profile seeds of their own, *unless* a test needs specific
  // display fields (verification/company/availability/etc — P22.1's
  // fuller card anatomy), in which case candidateProfileOverrides below
  // lets a test override the synthesized defaults per id.
  discoverCandidates: { id: string; score: number; reasons: string[]; tier?: number }[];
  availableNowCandidates: { id: string; score: number; reasons: string[]; tier?: number }[];
  discoverEmptyState: "no_supply" | "all_filtered" | "all_seen" | "profile_incomplete" | null;
  pendingRequestSenderIds: string[];
  // Milliseconds to artificially delay GET /discover (only) by — proves
  // independent per-section Suspense streaming (a slow top-matches query
  // must not delay the availability card or any other section).
  discoverDelayMs: number;
  // P22.1: per-candidate-id overrides for the synthesized GET
  // /profiles/:id response — keyed by candidate id, merged shallowly
  // over the default synthetic profile.
  candidateProfileOverrides: Record<string, Record<string, unknown>>;
  // P22.3: what POST /connections/requests should do — mirrors the three
  // outcomes connections.service.ts's own sendRequest can actually
  // produce (201 sent, 202 queued via BR-CONN's inbound throttle, or 429
  // DAILY_LIMIT_REACHED with an upgrade-worthy quota payload).
  sendConnectionRequestOutcome: "success" | "queued" | "daily_limit_reached";
  // P23.1: stateful connection-request rows, mutable via accept/reject/
  // withdraw so a test can seed a pending request, act on it through
  // these same endpoints the BFF calls, and assert what the *other*
  // direction's GET view renders afterward — this is what makes the
  // "silent rejection is airtight through the UI layer" acceptance test
  // possible against this mock. `direction` says which tab this profile
  // sees the row under (this mock has no separate per-user identity, so
  // it can't model a real second party's own GET — the client-side
  // masking behavior under test doesn't depend on that).
  requests: MockRequestRow[];
  requestsThrottle: { enabled: boolean; daily_cap: number; queued_count: number } | null;
  // P23.1: stateful conversation rows for the chat list — mutable via
  // PATCH (pin/mute/archive) and POST .../read.
  conversations: MockConversationRow[];
  // P24.1: the richer profile sub-resources GET/PATCH /profiles/me and
  // GET /profiles/:userId (self-view) both now return, mutable via the
  // profile-children endpoints (skills PUT already existed; the rest are
  // new). `etag` is a real, mutating value here (not a static string) so
  // a test can force a real If-Match conflict — bump it out from under
  // the page's own held value by PATCHing directly, then assert the
  // page's own next save surfaces the conflict UI rather than silently
  // overwriting.
  about: string | null;
  skills: { name: string; proficiency: string | null; years: number | null }[];
  interests: string[];
  languages: { code: string; proficiency: string }[];
  experience: MockExperienceRow[];
  education: MockEducationRow[];
  certifications: MockCertificationRow[];
  portfolio: MockPortfolioRow[];
  etag: string;
  // P24.1: ids that GET /profiles/:userId should answer as
  // BLOCKED (403) or PROFILE_NOT_FOUND (404, the same collapsed shape a
  // genuinely nonexistent id gets) — lets a test exercise the "identical
  // copy for both" acceptance criterion against two distinct real wire
  // outcomes.
  blockedProfileIds: string[];
  privateProfileIds: string[];
  // P24.2: search/notifications/settings/premium seedable state.
  plan: "free" | "premium";
  dailyRequestsUsed: number;
  notifications: MockNotificationRow[];
  inboundFilters: {
    accepted_intents: string[] | null;
    min_experience_years: number | null;
    max_experience_years: number | null;
    industries: number[] | null;
    verified_only: boolean;
    max_inbound_per_day: number | null;
  };
  notificationPreferences: {
    categories: Record<string, { push?: boolean; in_app?: boolean; email?: boolean }>;
    quiet_hours: { enabled: boolean; start: string; end: string } | null;
  };
  blockedUsers: { blocked_id: string; reason: string | null; created_at: string }[];
  sessions: {
    id: string;
    device: string | null;
    ip_country: string | null;
    last_active_at: string;
    current: boolean;
  }[];
  profileViewersCount: number;
  profileViewersList: { user_id: string; full_name: string; viewed_at: string }[];
  searchResults: {
    user_id: string;
    full_name: string;
    headline: string | null;
    job_title: string | null;
    company_name: string | null;
    verification_level: number;
  }[];
  // P25.2: seedable POST /ai/icebreakers response — undefined/omitted
  // means "unavailable" (the real degraded-mode default), matching the
  // real gateway's own fail-open behaviour rather than defaulting to a
  // fabricated success.
  aiIcebreakers?: { status: "ok" | "unavailable"; openers?: { type: string; text: string }[] };
  // P26.2: undefined means "never PUT/rolled-back in this test" — GET
  // falls back to a fixed live default. Keyed per-token (not a bare
  // module-level variable) so concurrent admin-matching-weights.spec.ts
  // tests running in different Playwright workers against this one
  // shared mock-server process never clobber each other's state.
  matchingWeights?: Record<string, number>;
}

export interface MockNotificationRow {
  id: string;
  category: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  priority: string;
  read_at: string | null;
  created_at: string;
}

export interface MockExperienceRow {
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

export interface MockEducationRow {
  id: string;
  school: string;
  degree: string | null;
  field_of_study: string | null;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
  position: number;
}

export interface MockCertificationRow {
  id: string;
  name: string;
  issuer: string;
  issued_at: string | null;
  expires_at: string | null;
  credential_url: string | null;
  position: number;
}

export interface MockPortfolioRow {
  id: string;
  title: string;
  url: string;
  description: string | null;
  position: number;
}

export interface MockRequestRow {
  id: string;
  direction: "sent" | "received";
  status: "pending" | "accepted" | "rejected" | "cancelled" | "expired";
  counterpartyId: string;
  intentType?: string | null;
  note?: string | null;
  matchScore?: number | null;
  matchReasons?: string[];
  createdAt?: string;
  expiresAt?: string;
}

export interface MockConversationRow {
  id: string;
  participantId: string | null;
  participantName: string | null;
  lastMessage?: {
    bodyPreview: string | null;
    senderId: string | null;
    createdAt: string | null;
    type: string | null;
  } | null;
  unreadCount?: number;
  isPinned?: boolean;
  mutedUntil?: string | null;
  isArchived?: boolean;
  intentType?: string | null;
}

export const MOCK_INDUSTRIES = [
  { id: 1, name: "Technology" },
  { id: 2, name: "Finance" },
  { id: 3, name: "Healthcare" },
];

// A representative subset of the real 14-type taxonomy
// (intent-taxonomy.ts) — enough variety to exercise every prerequisite
// kind the intents form checks (company/experience/verification), not a
// full transcription.
export const MOCK_INTENT_TAXONOMY = [
  {
    type: "coffee_chat",
    label: "Coffee Chat",
    category: "Network",
    complements: ["coffee_chat"],
    peerMatch: "all (0.45)",
    prerequisites: [],
  },
  {
    type: "need_mentor",
    label: "Need a Mentor",
    category: "Growth",
    complements: ["need_mentee"],
    peerMatch: "learning (0.4)",
    prerequisites: [],
  },
  {
    type: "hiring",
    label: "Hiring",
    category: "Career",
    complements: ["looking_for_job"],
    peerMatch: null,
    prerequisites: ["company_on_profile"],
  },
  {
    type: "need_mentee",
    label: "Want to Mentor",
    category: "Growth",
    complements: ["need_mentor"],
    peerMatch: null,
    prerequisites: ["experience_years_3"],
  },
  {
    type: "need_cofounder",
    label: "Need a Co-Founder",
    category: "Venture",
    complements: ["need_cofounder"],
    peerMatch: "startup_discussion (0.6)",
    prerequisites: ["verification_level_2"],
  },
];

function defaultProfile(): MockProfileState {
  return {
    full_name: "Test User",
    headline: null,
    job_title: null,
    company: null,
    industry: null,
    years_experience: null,
    location: { city: null, state: null, country: null, timezone: null, distance_bucket: null },
    verification: { level: 0 },
    intents: [],
    currentSession: null,
    nearbyUserCount: 3,
    availableNowCount: 3,
    planLimit: 3,
    discoverCandidates: [],
    availableNowCandidates: [],
    discoverEmptyState: "no_supply",
    pendingRequestSenderIds: [],
    discoverDelayMs: 0,
    candidateProfileOverrides: {},
    sendConnectionRequestOutcome: "success",
    requests: [],
    requestsThrottle: null,
    conversations: [],
    about: null,
    skills: [],
    interests: [],
    languages: [],
    experience: [],
    education: [],
    certifications: [],
    portfolio: [],
    etag: "etag-0",
    blockedProfileIds: [],
    privateProfileIds: [],
    plan: "free",
    dailyRequestsUsed: 0,
    notifications: [],
    inboundFilters: {
      accepted_intents: null,
      min_experience_years: null,
      max_experience_years: null,
      industries: null,
      verified_only: false,
      max_inbound_per_day: null,
    },
    notificationPreferences: { categories: {}, quiet_hours: null },
    blockedUsers: [],
    sessions: [
      {
        id: "session-current",
        device: "This browser",
        ip_country: "IN",
        last_active_at: new Date().toISOString(),
        current: true,
      },
    ],
    profileViewersCount: 0,
    profileViewersList: [],
    searchResults: [],
  };
}

// Encodes an initial profile state into a fake bearer token so each test can
// seed its own starting condition without any test coordinating with any
// other — the mock server is a single process shared across Playwright's
// parallel workers, so per-test isolation comes from each test minting its
// own unique token, not from server-side reset hooks. State for a given
// token is then held in memory for the rest of that test (PATCH/POST/DELETE
// mutate it), which is what makes the "reload resumes with data intact"
// tests meaningful against this mock, not just a canned fixture.
export function mockToken(seed: Partial<MockProfileState> = {}): string {
  const uniqueId = Math.random().toString(36).slice(2);
  const encodedSeed = Buffer.from(JSON.stringify(seed), "utf8").toString("base64url");
  return `mock:${encodedSeed}:${uniqueId}`;
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text) as Record<string, unknown>);
      } catch (error) {
        reject(error as Error);
      }
    });
    req.on("error", reject);
  });
}

let mockIntentSequence = 0;

function isPrerequisiteMet(id: string, profile: MockProfileState): boolean {
  switch (id) {
    case "company_on_profile":
      return profile.company !== null;
    case "experience_years_3":
      return Number(profile.years_experience ?? "0") >= 3;
    case "verification_level_2":
      return profile.verification.level >= 2;
    default:
      return true;
  }
}

export function startMockApiServer(port: number) {
  const state = new Map<string, MockProfileState>();

  function profileFor(token: string): MockProfileState {
    const existing = state.get(token);
    if (existing) return existing;

    let seed: Partial<MockProfileState> = {};
    const seedMatch = /^mock:([^:]*):/.exec(token);
    if (seedMatch?.[1]) {
      try {
        seed = JSON.parse(
          Buffer.from(seedMatch[1], "base64url").toString("utf8"),
        ) as Partial<MockProfileState>;
      } catch {
        seed = {};
      }
    }
    const base = defaultProfile();
    const profile: MockProfileState = {
      ...base,
      ...seed,
      location: { ...base.location, ...seed.location },
      verification: { ...base.verification, ...seed.verification },
      intents: seed.intents ?? [],
      // Bootstrap `requests` from the legacy pendingRequestSenderIds knob
      // when a test hasn't seeded `requests` directly, so existing P21.2
      // home-strip tests (which only know about pendingRequestSenderIds)
      // keep working unchanged against the same ids/scores they always got.
      requests:
        seed.requests ??
        (seed.pendingRequestSenderIds ?? []).map((senderId, index) => ({
          id: `mock-request-${index}`,
          direction: "received" as const,
          status: "pending" as const,
          counterpartyId: senderId,
          matchScore: 70 + index,
          matchReasons: [],
        })),
    };
    state.set(token, profile);
    return profile;
  }

  // P24.1: mirrors apps/api's real ProfileResponse (profile.service.ts),
  // used for both GET /profiles/me and GET /profiles/:userId's self-view
  // branch — `user_id` is hardcoded "u1" since every e2e test in this
  // codebase seeds its session cookie with that same fixed id (see every
  // spec's own authCookies() helper), the same convention connection
  // requests' "self" sentinel already relies on.
  function profileResponse(profile: MockProfileState) {
    return {
      user_id: "u1",
      full_name: profile.full_name,
      headline: profile.headline,
      about: profile.about,
      avatar: null,
      industry: profile.industry,
      job_title: profile.job_title,
      company: profile.company,
      years_experience: profile.years_experience ?? "0",
      skills: profile.skills,
      interests: profile.interests,
      languages: profile.languages,
      experience: profile.experience,
      education: profile.education,
      certifications: profile.certifications,
      portfolio: profile.portfolio,
      location: profile.location,
      verification: profile.verification,
      reputation: { band: "new", response_rate: null, median_response_minutes: null },
      availability: profile.currentSession
        ? { state: profile.currentSession.state, expires_at: profile.currentSession.expires_at }
        : null,
      intents: profile.intents.map((intent) => ({
        type: intent.type,
        detail: intent.detail,
        expires_at: intent.expires_at,
      })),
      mutual_connections: { count: 0 },
      relationship: { status: "self" as const, can_request: false },
      compatibility: null,
      profile_completion: 72,
    };
  }

  function quoteEtag(value: string): string {
    return `"${value}"`;
  }

  function intentResponse(intent: MockIntent) {
    return intent;
  }

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  }

  function errorBody(code: string, message: string, details: unknown = null) {
    return { error: { code, message, field: null, details, request_id: null, retry_after: null } };
  }

  const server = createServer((req, res) => {
    void (async () => {
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      const path = url.pathname;

      if (path === "/profiles/me" && req.method === "GET") {
        const current = profileFor(token);
        res.setHeader("ETag", quoteEtag(current.etag));
        sendJson(res, 200, profileResponse(current));
        return;
      }

      // P24.1: real optimistic-concurrency check, not a static always-
      // matching value — a test can force a genuine conflict by PATCHing
      // directly (bumping `etag`) out from under a page that's still
      // holding an older value, then assert that page's own next save
      // surfaces the conflict UI (409 ETAG_MISMATCH) instead of silently
      // overwriting.
      if (path === "/profiles/me" && req.method === "PATCH") {
        const current = profileFor(token);
        const ifMatch = (req.headers["if-match"] ?? "").toString().replace(/^"|"$/g, "");
        if (ifMatch !== current.etag) {
          sendJson(
            res,
            409,
            errorBody(
              "ETAG_MISMATCH",
              "This profile was changed since you last loaded it. Refresh and try again.",
            ),
          );
          return;
        }
        const body = await readJsonBody(req);
        if (typeof body.full_name === "string") current.full_name = body.full_name;
        if (typeof body.headline === "string") current.headline = body.headline;
        if ("about" in body) current.about = body.about as string | null;
        if (typeof body.job_title === "string") current.job_title = body.job_title;
        if ("company_name" in body)
          current.company = body.company_name
            ? { name: body.company_name as string, verified: false }
            : null;
        if (typeof body.industry_id === "number") {
          const industry = MOCK_INDUSTRIES.find((entry) => entry.id === body.industry_id);
          current.industry = industry ? { id: industry.id, label: industry.name } : null;
        }
        if (typeof body.years_experience === "number")
          current.years_experience = String(body.years_experience);
        mockIntentSequence += 1;
        current.etag = `etag-${mockIntentSequence}`;
        res.setHeader("ETag", quoteEtag(current.etag));
        sendJson(res, 200, profileResponse(current));
        return;
      }

      if (path === "/profiles/me/skills" && req.method === "PUT") {
        const body = await readJsonBody(req);
        const current = profileFor(token);
        current.skills = (body.skills as MockProfileState["skills"]) ?? [];
        sendJson(res, 200, { replaced: true });
        return;
      }

      if (path === "/profiles/me/interests" && req.method === "PUT") {
        const body = await readJsonBody(req);
        const current = profileFor(token);
        current.interests = Array.isArray(body) ? (body as string[]) : [];
        sendJson(res, 200, { replaced: true });
        return;
      }

      if (path === "/profiles/me/languages" && req.method === "PUT") {
        const body = await readJsonBody(req);
        const current = profileFor(token);
        current.languages = Array.isArray(body) ? (body as MockProfileState["languages"]) : [];
        sendJson(res, 200, { replaced: true });
        return;
      }

      if (path === "/profiles/me/completion" && req.method === "GET") {
        const current = profileFor(token);
        const missing: { field: string; impact: number; cta: string }[] = [];
        if (current.skills.length < 5)
          missing.push({ field: "skills", impact: 6, cta: "add 2 more skills" });
        if (!current.about)
          missing.push({ field: "about", impact: 10, cta: "write an About section" });
        if (current.experience.length === 0)
          missing.push({ field: "experience", impact: 15, cta: "add your experience" });
        const score = Math.max(0, 100 - missing.reduce((total, entry) => total + entry.impact, 0));
        sendJson(res, 200, { score, missing });
        return;
      }

      if (path === "/profiles/me/experience" && req.method === "POST") {
        const body = await readJsonBody(req);
        const current = profileFor(token);
        mockIntentSequence += 1;
        const row: MockExperienceRow = {
          id: `mock-experience-${mockIntentSequence}`,
          company_name: (body.company_name as string) ?? "",
          title: (body.title as string) ?? "",
          employment_type: (body.employment_type as string | undefined) ?? null,
          location_text: (body.location_text as string | undefined) ?? null,
          description: (body.description as string | undefined) ?? null,
          start_date: (body.start_date as string) ?? new Date().toISOString(),
          end_date: (body.end_date as string | null | undefined) ?? null,
          is_current: Boolean(body.is_current),
          position: current.experience.length,
        };
        current.experience.push(row);
        sendJson(res, 201, row);
        return;
      }

      const experienceIdMatch = /^\/profiles\/me\/experience\/([^/]+)$/.exec(path);
      if (experienceIdMatch && req.method === "PATCH") {
        const current = profileFor(token);
        const row = current.experience.find((entry) => entry.id === experienceIdMatch[1]);
        if (!row) {
          sendJson(res, 404, errorBody("NOT_FOUND", "This entry could not be found."));
          return;
        }
        const body = await readJsonBody(req);
        Object.assign(row, body);
        sendJson(res, 200, row);
        return;
      }
      if (experienceIdMatch && req.method === "DELETE") {
        const current = profileFor(token);
        current.experience = current.experience.filter(
          (entry) => entry.id !== experienceIdMatch[1],
        );
        res.statusCode = 204;
        res.end();
        return;
      }

      if (path === "/profiles/me/education" && req.method === "POST") {
        const body = await readJsonBody(req);
        const current = profileFor(token);
        mockIntentSequence += 1;
        const row: MockEducationRow = {
          id: `mock-education-${mockIntentSequence}`,
          school: (body.school as string) ?? "",
          degree: (body.degree as string | undefined) ?? null,
          field_of_study: (body.field_of_study as string | undefined) ?? null,
          start_date: (body.start_date as string | undefined) ?? null,
          end_date: (body.end_date as string | undefined) ?? null,
          description: (body.description as string | undefined) ?? null,
          position: current.education.length,
        };
        current.education.push(row);
        sendJson(res, 201, row);
        return;
      }

      const educationIdMatch = /^\/profiles\/me\/education\/([^/]+)$/.exec(path);
      if (educationIdMatch && req.method === "PATCH") {
        const current = profileFor(token);
        const row = current.education.find((entry) => entry.id === educationIdMatch[1]);
        if (!row) {
          sendJson(res, 404, errorBody("NOT_FOUND", "This entry could not be found."));
          return;
        }
        const body = await readJsonBody(req);
        Object.assign(row, body);
        sendJson(res, 200, row);
        return;
      }
      if (educationIdMatch && req.method === "DELETE") {
        const current = profileFor(token);
        current.education = current.education.filter((entry) => entry.id !== educationIdMatch[1]);
        res.statusCode = 204;
        res.end();
        return;
      }

      if (path === "/profiles/me/certifications" && req.method === "POST") {
        const body = await readJsonBody(req);
        const current = profileFor(token);
        mockIntentSequence += 1;
        const row: MockCertificationRow = {
          id: `mock-certification-${mockIntentSequence}`,
          name: (body.name as string) ?? "",
          issuer: (body.issuer as string) ?? "",
          issued_at: (body.issued_at as string | undefined) ?? null,
          expires_at: (body.expires_at as string | undefined) ?? null,
          credential_url: (body.credential_url as string | undefined) ?? null,
          position: current.certifications.length,
        };
        current.certifications.push(row);
        sendJson(res, 201, row);
        return;
      }

      const certificationIdMatch = /^\/profiles\/me\/certifications\/([^/]+)$/.exec(path);
      if (certificationIdMatch && req.method === "PATCH") {
        const current = profileFor(token);
        const row = current.certifications.find((entry) => entry.id === certificationIdMatch[1]);
        if (!row) {
          sendJson(res, 404, errorBody("NOT_FOUND", "This entry could not be found."));
          return;
        }
        const body = await readJsonBody(req);
        Object.assign(row, body);
        sendJson(res, 200, row);
        return;
      }
      if (certificationIdMatch && req.method === "DELETE") {
        const current = profileFor(token);
        current.certifications = current.certifications.filter(
          (entry) => entry.id !== certificationIdMatch[1],
        );
        res.statusCode = 204;
        res.end();
        return;
      }

      if (path === "/profiles/me/portfolio" && req.method === "POST") {
        const body = await readJsonBody(req);
        const current = profileFor(token);
        mockIntentSequence += 1;
        const row: MockPortfolioRow = {
          id: `mock-portfolio-${mockIntentSequence}`,
          title: (body.title as string) ?? "",
          url: (body.url as string) ?? "",
          description: (body.description as string | undefined) ?? null,
          position: current.portfolio.length,
        };
        current.portfolio.push(row);
        sendJson(res, 201, row);
        return;
      }

      const portfolioIdMatch = /^\/profiles\/me\/portfolio\/([^/]+)$/.exec(path);
      if (portfolioIdMatch && req.method === "PATCH") {
        const current = profileFor(token);
        const row = current.portfolio.find((entry) => entry.id === portfolioIdMatch[1]);
        if (!row) {
          sendJson(res, 404, errorBody("NOT_FOUND", "This entry could not be found."));
          return;
        }
        const body = await readJsonBody(req);
        Object.assign(row, body);
        sendJson(res, 200, row);
        return;
      }
      if (portfolioIdMatch && req.method === "DELETE") {
        const current = profileFor(token);
        current.portfolio = current.portfolio.filter((entry) => entry.id !== portfolioIdMatch[1]);
        res.statusCode = 204;
        res.end();
        return;
      }

      if (path === "/taxonomies/industries" && req.method === "GET") {
        sendJson(res, 200, { industries: MOCK_INDUSTRIES });
        return;
      }

      if (path === "/taxonomies/cities" && req.method === "GET") {
        sendJson(res, 200, { cities: [{ id: 9114, name: "Jabalpur", countryCode: "IN" }] });
        return;
      }

      if (path === "/intents/taxonomy" && req.method === "GET") {
        sendJson(res, 200, MOCK_INTENT_TAXONOMY);
        return;
      }

      if (path === "/intents" && req.method === "GET") {
        sendJson(res, 200, profileFor(token).intents.map(intentResponse));
        return;
      }

      if (path === "/intents" && req.method === "POST") {
        const body = await readJsonBody(req);
        const profile = profileFor(token);
        const type = body.type as string;

        if (profile.intents.some((intent) => intent.type === type && intent.status === "active")) {
          sendJson(res, 409, errorBody("DUPLICATE_INTENT", "You already have this intent active."));
          return;
        }
        if (
          profile.intents.filter((intent) => intent.status === "active").length >= profile.planLimit
        ) {
          sendJson(
            res,
            402,
            errorBody("PLAN_LIMIT_REACHED", "Upgrade to add more intents.", {
              limit: profile.planLimit,
            }),
          );
          return;
        }
        const taxonomyEntry = MOCK_INTENT_TAXONOMY.find((entry) => entry.type === type);
        const unmet = (taxonomyEntry?.prerequisites ?? []).filter(
          (id) => !isPrerequisiteMet(id, profile),
        );
        if (unmet.length > 0) {
          sendJson(
            res,
            422,
            errorBody("INTENT_PREREQUISITE_UNMET", "This intent has unmet prerequisites.", {
              unmet,
            }),
          );
          return;
        }

        const activeCount = profile.intents.filter((intent) => intent.status === "active").length;
        const wantsPrimary = activeCount === 0 || body.is_primary === true;
        if (wantsPrimary) {
          for (const intent of profile.intents)
            if (intent.status === "active") intent.is_primary = false;
        }

        mockIntentSequence += 1;
        const created: MockIntent = {
          id: `mock-intent-${mockIntentSequence}`,
          type,
          detail: (body.detail as string | undefined) ?? null,
          metadata: body.metadata ?? {},
          is_primary: wantsPrimary,
          is_paused: false,
          status: "active",
          expires_at: new Date(
            Date.now() + ((body.expires_in_days as number) ?? 30) * 86_400_000,
          ).toISOString(),
          renewed_count: 0,
          created_at: new Date().toISOString(),
        };
        profile.intents.push(created);

        sendJson(res, 201, {
          intent: intentResponse(created),
          active_count: activeCount + 1,
          plan_limit: profile.planLimit,
          match_preview: { potential_matches: 0, nearby: 0 },
        });
        return;
      }

      const patchMatch = /^\/intents\/([^/]+)$/.exec(path);
      if (patchMatch && req.method === "PATCH") {
        const profile = profileFor(token);
        const intent = profile.intents.find((existing) => existing.id === patchMatch[1]);
        if (!intent) {
          sendJson(res, 404, errorBody("INTENT_NOT_FOUND", "This intent could not be found."));
          return;
        }
        const body = await readJsonBody(req);
        if ("detail" in body) intent.detail = body.detail as string | null;
        if (typeof body.expires_in_days === "number")
          intent.expires_at = new Date(
            Date.now() + body.expires_in_days * 86_400_000,
          ).toISOString();
        if (typeof body.is_paused === "boolean") intent.is_paused = body.is_paused;
        sendJson(res, 200, intentResponse(intent));
        return;
      }

      if (patchMatch && req.method === "DELETE") {
        const profile = profileFor(token);
        const index = profile.intents.findIndex((existing) => existing.id === patchMatch[1]);
        if (index === -1) {
          sendJson(res, 404, errorBody("INTENT_NOT_FOUND", "This intent could not be found."));
          return;
        }
        const [removed] = profile.intents.splice(index, 1);
        if (removed?.is_primary) {
          const next = [...profile.intents]
            .filter((intent) => intent.status === "active")
            .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
          if (next) next.is_primary = true;
        }
        res.statusCode = 204;
        res.end();
        return;
      }

      const primaryMatch = /^\/intents\/([^/]+)\/primary$/.exec(path);
      if (primaryMatch && req.method === "POST") {
        const profile = profileFor(token);
        const intent = profile.intents.find((existing) => existing.id === primaryMatch[1]);
        if (!intent) {
          sendJson(res, 404, errorBody("INTENT_NOT_FOUND", "This intent could not be found."));
          return;
        }
        for (const existing of profile.intents) existing.is_primary = existing.id === intent.id;
        sendJson(res, 200, intentResponse(intent));
        return;
      }

      if (path === "/location" && req.method === "PUT") {
        const profile = profileFor(token);
        profile.location = {
          city: "Jabalpur",
          state: "Madhya Pradesh",
          country: "IN",
          timezone: "Asia/Kolkata",
          distance_bucket: null,
        };
        sendJson(res, 200, {
          city: { id: 9114, name: "Jabalpur" },
          state: "Madhya Pradesh",
          country: "IN",
          timezone: "Asia/Kolkata",
          nearby_user_count: profile.nearbyUserCount,
        });
        return;
      }

      if (path === "/location/manual" && req.method === "PUT") {
        const profile = profileFor(token);
        profile.location = {
          city: "Jabalpur",
          state: "Madhya Pradesh",
          country: "IN",
          timezone: "Asia/Kolkata",
          distance_bucket: null,
        };
        sendJson(res, 200, {
          city: { id: 9114, name: "Jabalpur" },
          state: "Madhya Pradesh",
          country: "IN",
          timezone: "Asia/Kolkata",
          nearby_user_count: profile.nearbyUserCount,
        });
        return;
      }

      if (path === "/location/privacy" && req.method === "PUT") {
        const body = await readJsonBody(req);
        sendJson(res, 200, { location_privacy: body.location_privacy });
        return;
      }

      if (path === "/preferences/location" && req.method === "PUT") {
        const body = await readJsonBody(req);
        sendJson(res, 200, {
          search_radius_km: body.search_radius_km,
          remote_preference: body.remote_preference,
          open_to_relocate: body.open_to_relocate ?? false,
          relocate_target_city_ids: [],
          auto_expand_radius: false,
          pinned_tier: null,
        });
        return;
      }

      if (path === "/availability/sessions" && req.method === "POST") {
        const body = await readJsonBody(req);
        const profile = profileFor(token);
        mockIntentSequence += 1;
        const durationMinutes = (body.duration_minutes as number) ?? 30;
        const session: MockSession = {
          id: `mock-session-${mockIntentSequence}`,
          state: body.state as string,
          started_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + durationMinutes * 60_000).toISOString(),
          duration_minutes: durationMinutes,
          extensions_used: 0,
          extensions_remaining: 3,
          note: (body.note as string | undefined) ?? null,
          session_intents: [],
        };
        profile.currentSession = session;
        sendJson(res, 201, {
          session,
          match_preview:
            body.state === "available_now"
              ? {
                  available_now_count: profile.availableNowCount,
                  nearby_count: profile.nearbyUserCount,
                  top_score: null,
                }
              : null,
        });
        return;
      }

      if (path === "/availability/me" && req.method === "GET") {
        sendJson(res, 200, { current_session: profileFor(token).currentSession });
        return;
      }

      const extendMatch = /^\/availability\/sessions\/([^/]+)\/extend$/.exec(path);
      if (extendMatch && req.method === "PATCH") {
        const profile = profileFor(token);
        const body = await readJsonBody(req);
        const session = profile.currentSession;
        if (!session || session.id !== extendMatch[1]) {
          sendJson(res, 404, errorBody("SESSION_NOT_FOUND", "This session could not be found."));
          return;
        }
        const additionalMinutes = body.additional_minutes as number;
        session.expires_at = new Date(
          new Date(session.expires_at!).getTime() + additionalMinutes * 60_000,
        ).toISOString();
        session.extensions_used += 1;
        session.extensions_remaining = Math.max(0, session.extensions_remaining - 1);
        sendJson(res, 200, session);
        return;
      }

      const endMatch = /^\/availability\/sessions\/([^/]+)$/.exec(path);
      if (endMatch && req.method === "DELETE") {
        const profile = profileFor(token);
        if (!profile.currentSession || profile.currentSession.id !== endMatch[1]) {
          sendJson(res, 404, errorBody("SESSION_NOT_FOUND", "This session could not be found."));
          return;
        }
        profile.currentSession = null;
        sendJson(res, 200, {
          matches_viewed: 0,
          requests_sent: 0,
          conversations_started: 0,
          duration_actual_minutes: 0,
        });
        return;
      }

      // P21.2: GET /discover and /discover/available-now, and
      // GET /profiles/:userId (a *different* route from /profiles/me,
      // reached here since that literal path is checked earlier and
      // already returned by this point). No batched "match card"
      // endpoint exists in the real backend either (client.ts's own
      // DiscoveryResponse comment) — this synthesizes a display profile
      // for any id, matching real GET /profiles/:userId's shape.
      const profileByIdMatch = /^\/profiles\/([^/]+)$/.exec(path);
      if (profileByIdMatch && req.method === "GET") {
        const id = profileByIdMatch[1]!;
        const caller = profileFor(token);

        // P24.1: "u1" is every e2e test's own fixed session_user id (see
        // each spec's authCookies() helper) — viewing that id is a
        // self-view, mirroring apps/api's real GET /profiles/:userId
        // handling its own caller the same as GET /profiles/me.
        if (id === "u1") {
          sendJson(res, 200, profileResponse(caller));
          return;
        }

        // P24.1's own acceptance criterion: blocked (403) and private-or-
        // nonexistent (404) must produce two genuinely distinct real wire
        // outcomes here, so a test can assert the BFF/UI layer collapses
        // them into identical rendered copy rather than the mock having
        // already done that collapsing for them.
        if (caller.blockedProfileIds.includes(id)) {
          sendJson(res, 403, errorBody("BLOCKED", "You can't view this profile."));
          return;
        }
        if (caller.privateProfileIds.includes(id)) {
          sendJson(res, 404, errorBody("PROFILE_NOT_FOUND", "This profile isn't available"));
          return;
        }

        const overrides = caller.candidateProfileOverrides[id] ?? {};
        const defaults = {
          user_id: id,
          full_name: `Member ${id}`,
          headline: "Product person",
          about: null,
          avatar: null,
          industry: null,
          company: null,
          job_title: null,
          years_experience: "5",
          skills: [],
          interests: [],
          languages: [],
          experience: [],
          education: [],
          certifications: [],
          portfolio: [],
          location: {
            city: "Bengaluru",
            state: "Karnataka",
            country: "India",
            timezone: "Asia/Kolkata",
            distance_bucket: "~5 km away",
          },
          verification: { level: 0 },
          reputation: { band: "new", response_rate: null, median_response_minutes: null },
          availability: null,
          intents: [],
          mutual_connections: { count: 0 },
          relationship: { status: "stranger", can_request: true },
          compatibility: null,
        };
        sendJson(res, 200, { ...defaults, ...overrides });
        return;
      }

      if (path === "/discover" && req.method === "GET") {
        const profile = profileFor(token);
        if (profile.discoverDelayMs > 0)
          await new Promise((resolve) => setTimeout(resolve, profile.discoverDelayMs));
        sendJson(res, 200, {
          data: profile.discoverCandidates.map((candidate) => ({
            candidate_id: candidate.id,
            score: candidate.score,
            reasons: candidate.reasons,
            expansion_stage: 0,
            location_tier: candidate.tier ?? 0,
          })),
          meta: { next_cursor: null, has_more: false, expansion_stage: 0 },
          empty_state: profile.discoverCandidates.length === 0 ? profile.discoverEmptyState : null,
        });
        return;
      }

      if (path === "/discover/available-now" && req.method === "GET") {
        const profile = profileFor(token);
        sendJson(res, 200, {
          data: profile.availableNowCandidates.map((candidate) => ({
            candidate_id: candidate.id,
            score: candidate.score,
            reasons: candidate.reasons,
            expansion_stage: 0,
            location_tier: candidate.tier ?? 0,
          })),
          meta: { next_cursor: null, has_more: false, expansion_stage: 0 },
          empty_state:
            profile.availableNowCandidates.length === 0 ? profile.discoverEmptyState : null,
        });
        return;
      }

      const skipMatch = /^\/matches\/([^/]+)\/skip$/.exec(path);
      if (skipMatch && req.method === "POST") {
        res.statusCode = 204;
        res.end();
        return;
      }

      const explainMatch = /^\/matches\/([^/]+)\/explain$/.exec(path);
      if (explainMatch && req.method === "GET") {
        // A fixed, representative sub-score breakdown (contributions sum
        // to exactly 79, mirroring explain.ts's own invariant) — enough
        // for a test to assert the bars render and the label set is
        // correct, without needing per-candidate scoring seeded.
        sendJson(res, 200, {
          score: 79,
          contributions: [
            { key: "intent", weight: 0.3, subScore: 1.0, contribution: 30 },
            { key: "avail", weight: 0.22, subScore: 0.65, contribution: 14 },
            { key: "skill", weight: 0.15, subScore: 0.58, contribution: 9 },
            { key: "exp", weight: 0.12, subScore: 0.72, contribution: 9 },
            { key: "loc", weight: 0.21, subScore: 0.4, contribution: 17 },
          ],
        });
        return;
      }

      if (path === "/reports" && req.method === "POST") {
        const body = await readJsonBody(req);
        sendJson(res, 201, {
          id: "mock-report-1",
          reference: "RPT-MOCK-1",
          category: body.category ?? "other",
          severity: "medium",
          status: "open",
          sla_due_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
          created_at: new Date().toISOString(),
        });
        return;
      }

      if (path === "/connections/requests" && req.method === "GET") {
        const profile = profileFor(token);
        const direction = (url.searchParams.get("direction") ?? "received") as "sent" | "received";
        const status = url.searchParams.get("status");
        const rows = profile.requests.filter(
          (row) => row.direction === direction && (!status || row.status === status),
        );

        sendJson(res, 200, {
          requests: rows.map((row) => ({
            id: row.id,
            status: row.status,
            sender_id: row.direction === "received" ? row.counterpartyId : "self",
            recipient_id: row.direction === "received" ? "self" : row.counterpartyId,
            intent: row.intentType
              ? { id: `${row.id}-intent`, type: row.intentType, detail: null }
              : null,
            note: row.note ?? null,
            match_score: row.matchScore ?? null,
            match_reasons: row.matchReasons ?? [],
            is_queued: false,
            created_at: row.createdAt ?? new Date().toISOString(),
            expires_at: row.expiresAt ?? new Date(Date.now() + 7 * 86_400_000).toISOString(),
          })),
          next_cursor: null,
          throttle: direction === "received" ? profile.requestsThrottle : null,
        });
        return;
      }

      const requestActionMatch = /^\/connections\/requests\/([^/]+)\/(accept|reject)$/.exec(path);
      if (requestActionMatch && req.method === "POST") {
        const profile = profileFor(token);
        const row = profile.requests.find((existing) => existing.id === requestActionMatch[1]);
        if (!row) {
          sendJson(res, 404, errorBody("REQUEST_NOT_FOUND", "This request could not be found."));
          return;
        }
        if (requestActionMatch[2] === "accept") {
          row.status = "accepted";
          sendJson(res, 200, {
            connection: { id: `mock-connection-${row.id}`, connected_at: new Date().toISOString() },
            conversation: {
              id: `mock-conversation-${row.id}`,
              first_message_id: `mock-message-${row.id}`,
            },
          });
          return;
        }
        row.status = "rejected";
        res.statusCode = 204;
        res.end();
        return;
      }

      const requestWithdrawMatch = /^\/connections\/requests\/([^/]+)$/.exec(path);
      if (requestWithdrawMatch && req.method === "DELETE") {
        const profile = profileFor(token);
        const row = profile.requests.find((existing) => existing.id === requestWithdrawMatch[1]);
        if (!row) {
          sendJson(res, 404, errorBody("REQUEST_NOT_FOUND", "This request could not be found."));
          return;
        }
        row.status = "cancelled";
        res.statusCode = 204;
        res.end();
        return;
      }

      if (path === "/conversations" && req.method === "GET") {
        const profile = profileFor(token);
        const filter = url.searchParams.get("filter") ?? "all";
        const rows = profile.conversations.filter((row) => {
          if (filter === "archived") return row.isArchived === true;
          if (row.isArchived) return false;
          if (filter === "unread") return (row.unreadCount ?? 0) > 0;
          if (filter === "pinned") return row.isPinned === true;
          return true;
        });

        sendJson(res, 200, {
          conversations: rows.map((row) => ({
            id: row.id,
            participant: { user_id: row.participantId, full_name: row.participantName },
            last_message: row.lastMessage ?? null,
            unread_count: row.unreadCount ?? 0,
            is_pinned: row.isPinned ?? false,
            is_muted_until: row.mutedUntil ?? null,
            is_archived: row.isArchived ?? false,
            connection: { intent: row.intentType ?? null },
          })),
        });
        return;
      }

      const conversationSettingsMatch = /^\/conversations\/([^/]+)$/.exec(path);
      if (conversationSettingsMatch && req.method === "PATCH") {
        const profile = profileFor(token);
        const row = profile.conversations.find(
          (existing) => existing.id === conversationSettingsMatch[1],
        );
        if (!row) {
          sendJson(
            res,
            404,
            errorBody("CONVERSATION_NOT_FOUND", "This conversation could not be found."),
          );
          return;
        }
        const body = await readJsonBody(req);
        if (typeof body.is_pinned === "boolean") row.isPinned = body.is_pinned;
        if ("muted_until" in body) row.mutedUntil = body.muted_until as string | null;
        if (typeof body.is_archived === "boolean") row.isArchived = body.is_archived;
        res.statusCode = 204;
        res.end();
        return;
      }

      const conversationReadMatch = /^\/conversations\/([^/]+)\/read$/.exec(path);
      if (conversationReadMatch && req.method === "POST") {
        const profile = profileFor(token);
        const row = profile.conversations.find(
          (existing) => existing.id === conversationReadMatch[1],
        );
        const body = await readJsonBody(req);
        if (row) row.unreadCount = 0;
        sendJson(res, 200, { unread_count: 0, last_read_seq: body.up_to_sequence ?? 0 });
        return;
      }

      if (path === "/connections/requests" && req.method === "POST") {
        await readJsonBody(req); // drain the request body
        const profile = profileFor(token);
        mockIntentSequence += 1;

        if (profile.sendConnectionRequestOutcome === "daily_limit_reached") {
          // Mirrors connections.service.ts's assertDailyQuotaAllowed:
          // 429 DAILY_LIMIT_REACHED with the quota surfaced in
          // error.details, matching the real shape RequestComposer reads.
          sendJson(
            res,
            429,
            errorBody("DAILY_LIMIT_REACHED", "You've reached today's request limit", {
              quota: {
                used: 8,
                limit: 8,
                resets_at: new Date(Date.now() + 3_600_000).toISOString(),
              },
            }),
          );
          return;
        }

        if (profile.sendConnectionRequestOutcome === "queued") {
          sendJson(res, 202, {
            request: {
              id: `mock-connreq-${mockIntentSequence}`,
              status: "pending",
              expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
            },
            quota: { used: 2, limit: 8, resets_at: new Date(Date.now() + 3_600_000).toISOString() },
            queued_position: 4,
          });
          return;
        }

        sendJson(res, 201, {
          request: {
            id: `mock-connreq-${mockIntentSequence}`,
            status: "pending",
            expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          },
          quota: { used: 2, limit: 8, resets_at: new Date(Date.now() + 3_600_000).toISOString() },
        });
        return;
      }

      // P24.2 mocks below.
      if (path === "/entitlements" && req.method === "GET") {
        const profile = profileFor(token);
        const isPremium = profile.plan !== "free";
        sendJson(res, 200, {
          plan: profile.plan,
          limits: {
            daily_requests: isPremium ? 30 : 8,
            active_intents: isPremium ? 8 : 3,
            max_session_duration_minutes: isPremium ? 240 : 120,
            max_search_radius_km: isPremium ? 500 : 100,
          },
          usage: {
            daily_requests_used: profile.dailyRequestsUsed,
            active_intents_used: profile.intents.filter((intent) => intent.status === "active")
              .length,
          },
          features: {
            advanced_search_filters: isPremium,
            who_viewed_me_full_list: isPremium,
            custom_session_duration: isPremium,
            custom_search_radius: isPremium,
          },
        });
        return;
      }

      if (path === "/search/users" && req.method === "GET") {
        const profile = profileFor(token);
        const q = url.searchParams.get("q") ?? "";
        if (q.length < 2) {
          sendJson(res, 400, errorBody("QUERY_TOO_SHORT", "Search for at least 2 characters"));
          return;
        }
        const premiumParams = ["skills", "skills_op", "min_exp", "max_exp", "verified_only"];
        const appliedPremium = premiumParams.filter((param) => url.searchParams.has(param));
        if (profile.plan === "free" && appliedPremium.length > 0) {
          sendJson(
            res,
            402,
            errorBody(
              "PREMIUM_FILTER_REQUIRED",
              `Filtering by ${appliedPremium[0]} is a Premium feature.`,
              { filter: appliedPremium[0] },
            ),
          );
          return;
        }
        sendJson(res, 200, {
          results: profile.searchResults,
          facets: { industries: [] },
          total_estimate: profile.searchResults.length,
          next_cursor: null,
          applied_premium_filters: appliedPremium,
        });
        return;
      }

      if (path === "/notifications" && req.method === "GET") {
        const profile = profileFor(token);
        const filter = url.searchParams.get("filter");
        const rows =
          filter === "unread"
            ? profile.notifications.filter((notification) => !notification.read_at)
            : profile.notifications;
        sendJson(res, 200, {
          notifications: rows,
          unread_count: profile.notifications.filter((notification) => !notification.read_at)
            .length,
        });
        return;
      }

      if (path === "/notifications/read" && req.method === "POST") {
        const profile = profileFor(token);
        const body = await readJsonBody(req);
        const nowIso = new Date().toISOString();
        if (body.all === true) {
          for (const notification of profile.notifications)
            notification.read_at = notification.read_at ?? nowIso;
        } else {
          const ids = new Set((body.ids as string[] | undefined) ?? []);
          for (const notification of profile.notifications)
            if (ids.has(notification.id)) notification.read_at = notification.read_at ?? nowIso;
        }
        res.statusCode = 204;
        res.end();
        return;
      }

      if (path === "/notifications/preferences" && req.method === "GET") {
        sendJson(res, 200, profileFor(token).notificationPreferences);
        return;
      }
      if (path === "/notifications/preferences" && req.method === "PUT") {
        const profile = profileFor(token);
        const body = await readJsonBody(req);
        if (body.categories)
          profile.notificationPreferences.categories = {
            ...profile.notificationPreferences.categories,
            ...(body.categories as Record<string, object>),
          };
        if (body.quiet_hours)
          profile.notificationPreferences.quiet_hours = body.quiet_hours as {
            enabled: boolean;
            start: string;
            end: string;
          };
        sendJson(res, 200, profile.notificationPreferences);
        return;
      }

      if (path === "/settings/inbound-intent-filters" && req.method === "GET") {
        sendJson(res, 200, profileFor(token).inboundFilters);
        return;
      }
      if (path === "/settings/inbound-intent-filters" && req.method === "PUT") {
        const profile = profileFor(token);
        const body = await readJsonBody(req);
        profile.inboundFilters = { ...profile.inboundFilters, ...body };
        sendJson(res, 200, profile.inboundFilters);
        return;
      }

      if (path === "/auth/sessions" && req.method === "GET") {
        sendJson(res, 200, { sessions: profileFor(token).sessions });
        return;
      }
      const sessionIdMatch = /^\/auth\/sessions\/([^/]+)$/.exec(path);
      if (sessionIdMatch && req.method === "DELETE") {
        const profile = profileFor(token);
        profile.sessions = profile.sessions.filter((session) => session.id !== sessionIdMatch[1]);
        res.statusCode = 204;
        res.end();
        return;
      }

      if (path === "/auth/password/change" && req.method === "POST") {
        sendJson(res, 200, { changed: true });
        return;
      }

      if (path === "/auth/account/delete" && req.method === "POST") {
        sendJson(res, 202, {
          purge_scheduled_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        });
        return;
      }
      if (path === "/auth/account/cancel-delete" && req.method === "POST") {
        sendJson(res, 200, { cancelled: true });
        return;
      }

      if (path === "/profiles/me/viewers" && req.method === "GET") {
        const profile = profileFor(token);
        const isPremium = profile.plan !== "free";
        sendJson(res, 200, {
          count: profile.profileViewersCount,
          viewers: isPremium ? profile.profileViewersList : [],
        });
        return;
      }

      if (path === "/blocks" && req.method === "GET") {
        sendJson(res, 200, { blocks: profileFor(token).blockedUsers });
        return;
      }
      if (path === "/ai/icebreakers" && req.method === "POST") {
        await readJsonBody(req);
        const profile = profileFor(token);
        sendJson(res, 200, profile.aiIcebreakers ?? { status: "unavailable" });
        return;
      }

      if (path === "/ai/first-message-metric" && req.method === "POST") {
        await readJsonBody(req);
        sendJson(res, 200, { recorded: true });
        return;
      }

      if (path === "/blocks" && req.method === "POST") {
        const profile = profileFor(token);
        const body = await readJsonBody(req);
        const userId = body.user_id as string;
        profile.blockedUsers.push({
          blocked_id: userId,
          reason: (body.reason as string | undefined) ?? null,
          created_at: new Date().toISOString(),
        });
        sendJson(res, 201, { blocked_id: userId });
        return;
      }
      const blockUserIdMatch = /^\/blocks\/([^/]+)$/.exec(path);
      if (blockUserIdMatch && req.method === "DELETE") {
        const profile = profileFor(token);
        profile.blockedUsers = profile.blockedUsers.filter(
          (entry) => entry.blocked_id !== blockUserIdMatch[1],
        );
        res.statusCode = 204;
        res.end();
        return;
      }

      // P26.1: the (admin)/admin report queue / moderation / appeals
      // screens. Minimal fixed fixtures — enough for the e2e coverage
      // this phase needs (row-expansion content view, the action
      // panel's disabled-until-clause-selected state) — not a full
      // seedable admin-state surface like MockProfileState above.
      if (path === "/admin/reports" && req.method === "GET") {
        sendJson(res, 200, {
          reports: [
            {
              id: "report-1",
              reference: "RPT-2026-000001",
              target_type: "message",
              target_id: "message-1",
              target_user_id: "user-9",
              category: "harassment_hate",
              severity: "high",
              status: "open",
              description: "Sent repeated unwanted messages.",
              assigned_to: null,
              sla_due_at: new Date(Date.now() + 3_600_000).toISOString(),
              created_at: new Date().toISOString(),
            },
          ],
        });
        return;
      }
      if (path === "/admin/reports/report-1/content" && req.method === "GET") {
        sendJson(res, 200, {
          target_type: "message",
          status: "ok",
          message: {
            id: "message-1",
            conversation_id: "conv-1",
            sender_id: "user-9",
            body: "You should really consider quitting your job.",
            type: "text",
            deleted_at: null,
            moderation_state: "clean",
            created_at: new Date().toISOString(),
          },
        });
        return;
      }
      if (path === "/admin/moderation-actions" && req.method === "GET") {
        sendJson(res, 200, { moderation_actions: [] });
        return;
      }
      if (path === "/admin/moderation-actions" && req.method === "POST") {
        const body = await readJsonBody(req);
        sendJson(res, 200, {
          id: "action-1",
          target_user_id: body.target_user_id ?? null,
          action: body.action,
          status: body.action === "ban" ? "pending_approval" : "active",
          policy_clause: body.policy_clause,
          rationale: body.rationale,
          expires_at: null,
          created_at: new Date().toISOString(),
        });
        return;
      }
      if (path === "/admin/appeals" && req.method === "GET") {
        sendJson(res, 200, { appeals: [] });
        return;
      }

      // P26.2: the matching-weights editor. Stateless (echoes back
      // whatever's PUT rather than actually persisting it, and rollback
      // always returns the same fixed "previous config") — this mock
      // server is one shared process across the whole parallel
      // Playwright run, so real cross-request state here would leak
      // between concurrently-running tests; each test only needs a
      // single request/response pair to exercise its own assertion.
      const DEFAULT_MOCK_WEIGHTS = {
        avail: 0.22,
        intent: 0.24,
        loc: 0.16,
        skill: 0.12,
        industry: 0.05,
        exp: 0.05,
        interest: 0.04,
        mutual: 0.05,
        activity: 0.03,
        rep: 0.02,
        lang: 0.02,
      };
      const PREVIOUS_MOCK_WEIGHTS = {
        avail: 0.2,
        intent: 0.26,
        loc: 0.16,
        skill: 0.12,
        industry: 0.05,
        exp: 0.05,
        interest: 0.04,
        mutual: 0.05,
        activity: 0.03,
        rep: 0.02,
        lang: 0.02,
      };
      if (path === "/admin/matching/weights" && req.method === "GET") {
        sendJson(res, 200, profileFor(token).matchingWeights ?? DEFAULT_MOCK_WEIGHTS);
        return;
      }
      if (path === "/admin/matching/weights" && req.method === "PUT") {
        const body = await readJsonBody(req);
        const weights = { ...body };
        delete weights.reason;
        profileFor(token).matchingWeights = weights as Record<string, number>;
        sendJson(res, 200, weights);
        return;
      }
      if (path === "/admin/matching/weights/rollback" && req.method === "POST") {
        await readJsonBody(req);
        profileFor(token).matchingWeights = PREVIOUS_MOCK_WEIGHTS;
        sendJson(res, 200, PREVIOUS_MOCK_WEIGHTS);
        return;
      }

      sendJson(res, 404, errorBody("NOT_FOUND", "not found"));
    })();
  });

  server.listen(port);
  return server;
}
