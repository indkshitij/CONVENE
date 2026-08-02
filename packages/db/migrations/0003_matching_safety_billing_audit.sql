-- PRD §16.3 MATCHING / REPUTATION, MEDIA, BILLING / SAFETY & AUDIT, plus
-- §16.4 materialised views. Closes out Phase 2 (§16.2 ER diagram).

-- ═══════════════ MATCHING ═══════════════
CREATE TABLE match_candidates (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  static_score  NUMERIC(5,4) NOT NULL,            -- slow components only
  components    JSONB NOT NULL,                   -- {skill, industry, exp, interest, mutual, lang}
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, candidate_id)
);
CREATE INDEX idx_mc_user_score ON match_candidates(user_id, static_score DESC);

CREATE TABLE feed_impressions (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  count        SMALLINT NOT NULL DEFAULT 1,
  interacted   BOOLEAN NOT NULL DEFAULT FALSE,
  last_shown_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, candidate_id)
);

-- ═══════════════ REPUTATION, MEDIA, BILLING ═══════════════
-- (media already created in 0001_profile_geo.sql)
CREATE TABLE reputation_scores (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  score       SMALLINT NOT NULL DEFAULT 50 CHECK (score BETWEEN 0 AND 100),
  band        TEXT NOT NULL DEFAULT 'new',
  components  JSONB NOT NULL DEFAULT '{}',
  response_rate NUMERIC(4,3),
  median_response_minutes INT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE plans (
  code TEXT PRIMARY KEY,                        -- free | premium | pro | enterprise
  name TEXT NOT NULL, entitlements JSONB NOT NULL,
  price_cents INT, currency CHAR(3), interval TEXT
);
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT public.uuidv7(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL REFERENCES plans(code),
  status TEXT NOT NULL CHECK (status IN ('trialing','active','past_due','canceled','expired')),
  provider TEXT NOT NULL, provider_subscription_id TEXT,
  current_period_start TIMESTAMPTZ, current_period_end TIMESTAMPTZ,
  trial_end TIMESTAMPTZ, cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_sub_active ON subscriptions(user_id)
  WHERE status IN ('trialing','active','past_due');

-- NOT GIVEN EXPLICIT DDL IN THE PRD: §16.2's ER diagram has
-- SUBSCRIPTIONS ||--o{ PAYMENTS : billed_by and §21 mentions Stripe +
-- Razorpay, but no CREATE TABLE for `payments` appears anywhere. Modelled on
-- the provider/status shape subscriptions already uses. Flagged as an
-- assumption, not a transcription.
CREATE TABLE payments (
  id                  UUID PRIMARY KEY DEFAULT public.uuidv7(),
  subscription_id     UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  amount_cents        INT NOT NULL,
  currency            CHAR(3) NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('pending','succeeded','failed','refunded')),
  provider             TEXT NOT NULL,
  provider_payment_id TEXT,
  failure_reason      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_subscription ON payments(subscription_id, created_at DESC);

-- NOT GIVEN EXPLICIT DDL IN THE PRD: §17.2 names ai_usage_logs as owned by
-- the AI Gateway module ("quotas, prompt assembly, model routing, output
-- validation, ai_usage_logs") and §16.2's ERD has USERS ||--o{ AI_USAGE_LOGS,
-- but no CREATE TABLE appears. Flagged as an assumption.
CREATE TABLE ai_usage_logs (
  id           UUID PRIMARY KEY DEFAULT public.uuidv7(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature      TEXT NOT NULL,        -- resume_review | intro_message | conversation_summary | ...
  model        TEXT NOT NULL,
  tokens_used  INT,
  cost_cents   INT,
  cached       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_usage_user_time ON ai_usage_logs(user_id, created_at DESC);

-- NOT GIVEN EXPLICIT DDL IN THE PRD: §10.8's device-registration API
-- (`POST /api/v1/devices {platform, push_token, app_version}`,
-- `DELETE /api/v1/devices/:id`) implies these fields; §16.2's ERD has
-- USERS ||--o{ DEVICES. Flagged as an assumption.
CREATE TABLE devices (
  id           UUID PRIMARY KEY DEFAULT public.uuidv7(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL CHECK (platform IN ('ios','android','web')),
  push_token   TEXT NOT NULL,
  app_version  TEXT,
  last_seen_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_device_token ON devices(push_token);
CREATE INDEX idx_devices_user ON devices(user_id);

-- NOT GIVEN EXPLICIT DDL IN THE PRD: §16.2's ERD has
-- USERS ||--|| USER_SETTINGS : configures, and §10.8 shows a notification
-- preferences payload ({categories:{...}, quiet_hours:{...}}); §10.2.9
-- shows a visibility PATCH ({profile_visibility, location_privacy,
-- show_last_seen, show_read_receipts} — the latter two aren't profiles
-- columns, so they live here). Flagged as an assumption.
CREATE TABLE user_settings (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  notification_prefs  JSONB NOT NULL DEFAULT '{}',
  quiet_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  quiet_hours_start   TIME,
  quiet_hours_end     TIME,
  show_last_seen      BOOLEAN NOT NULL DEFAULT TRUE,
  show_read_receipts  BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- NOT GIVEN EXPLICIT DDL IN THE PRD: §10.9's "Save this search (with alert
-- toggle)" component and the `/me/saved-searches` CRUD route imply these
-- fields; §16.2's ERD has USERS ||--o{ SAVED_SEARCHES. Flagged as an
-- assumption.
CREATE TABLE saved_searches (
  id              UUID PRIMARY KEY DEFAULT public.uuidv7(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            VARCHAR(100) NOT NULL,
  query           JSONB NOT NULL DEFAULT '{}',
  alert_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  last_alerted_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_saved_searches_user ON saved_searches(user_id);
CREATE INDEX idx_saved_searches_alerts ON saved_searches(alert_enabled) WHERE alert_enabled;

-- §16.3 gives this as an inline hint, not full DDL: "profile_views
-- (viewer_id, viewed_id, viewed_at)". Adds an id + index for the
-- "who viewed me, last N days" query (§10.2.9 GET /me/viewers?days=30).
CREATE TABLE profile_views (
  id         UUID PRIMARY KEY DEFAULT public.uuidv7(),
  viewer_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_profile_views_viewed ON profile_views(viewed_id, viewed_at DESC);

-- ═══════════════ SAFETY & AUDIT ═══════════════
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT public.uuidv7(),
  reference TEXT NOT NULL UNIQUE,
  reporter_id UUID REFERENCES users(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL, target_id UUID NOT NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  category TEXT NOT NULL, severity TEXT NOT NULL,
  description TEXT, evidence JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_review','upheld','dismissed','escalated')),
  assigned_to UUID, sla_due_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reports_queue ON reports(status, severity, sla_due_at) WHERE status IN ('open','in_review');

CREATE TABLE moderation_actions (
  id UUID PRIMARY KEY DEFAULT public.uuidv7(),
  target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_id UUID REFERENCES reports(id),
  admin_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('notice','warning','throttle','shadow_limit','suspend','ban','reverse')),
  policy_clause TEXT NOT NULL, rationale TEXT NOT NULL,
  expires_at TIMESTAMPTZ, reversed_by UUID, reversed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- PRD's own DDL gives `id BIGSERIAL PRIMARY KEY` on a table that is also
-- `PARTITION BY RANGE (created_at)` — Postgres rejects this outright (a
-- partitioned table's unique constraints must include the partition key).
-- `messages` (§10.7.7) correctly uses a composite PRIMARY KEY (id,
-- created_at) for the identical situation; mirrored here rather than
-- silently reproducing the PRD's inconsistency.
CREATE TABLE audit_logs (                          -- append-only; no UPDATE/DELETE grants
  id BIGSERIAL,
  actor_id UUID, actor_type TEXT NOT NULL,
  action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT,
  reason TEXT, before JSONB, after JSONB,
  ip INET, user_agent TEXT, request_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id, created_at DESC);
-- One partition so the table is immediately usable; scripts/create-partitions.ts
-- provisions messages' partitions only today — audit_logs partitioning follows
-- the same monthly scheme and should be added to that script before launch.
CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;

-- ═══════════════ §16.4 MATERIALISED VIEWS & DERIVED STRUCTURES ═══════════════
-- "a directed helper view over connections" — not given explicit DDL, but
-- unambiguous from that description: each undirected connection becomes two
-- directed (user_id, peer_id) rows.
CREATE VIEW connection_edges AS
  SELECT user_a_id AS user_id, user_b_id AS peer_id FROM connections WHERE removed_at IS NULL
  UNION ALL
  SELECT user_b_id AS user_id, user_a_id AS peer_id FROM connections WHERE removed_at IS NULL;

CREATE MATERIALIZED VIEW mutual_connection_counts AS
SELECT a.user_id AS u1, b.user_id AS u2, COUNT(*) AS mutual_count
FROM   connection_edges a JOIN connection_edges b ON a.peer_id = b.peer_id
WHERE  a.user_id < b.user_id
GROUP BY 1,2 HAVING COUNT(*) > 0;
CREATE UNIQUE INDEX ON mutual_connection_counts (u1, u2);
-- Refreshed CONCURRENTLY hourly (requires the unique index above).

-- ═══════════════ APPLICATION ROLE PRIVILEGE SEPARATION ═══════════════
-- audit_logs must be append-only at the database level, not just by
-- application convention. `convene_app` is the role the running API/worker
-- fleet connects as (never the role migrations run as); it gets full CRUD on
-- everything except audit_logs, which is SELECT + INSERT only.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'convene_app') THEN
    -- Dev/CI placeholder password — production must rotate this via secrets
    -- management, never rely on the value baked into this migration.
    CREATE ROLE convene_app LOGIN PASSWORD 'convene_app_dev_only';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO convene_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO convene_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO convene_app;
GRANT EXECUTE ON FUNCTION public.uuidv7() TO convene_app;
REVOKE UPDATE, DELETE ON audit_logs FROM convene_app;
REVOKE UPDATE, DELETE ON audit_logs_default FROM convene_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO convene_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO convene_app;
