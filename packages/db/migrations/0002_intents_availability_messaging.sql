-- PRD §10.3 (Availability), §10.4 (Intents), §10.6 (Connections), §10.7
-- (Messaging), §16.4 (availability_live). DDL copied verbatim from those
-- sections; ordered here so every forward reference resolves.

-- ═══════════════ INTENTS (§10.4.8) ═══════════════
CREATE TYPE intent_type AS ENUM (
  'looking_for_job','hiring','need_cofounder','need_mentor','need_mentee','internship',
  'freelancer','startup_discussion','ai_collaboration','business_networking',
  'coffee_chat','learning','investment_discussion','partnerships');

CREATE TABLE user_intents (
  id          UUID PRIMARY KEY DEFAULT public.uuidv7(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        intent_type NOT NULL,
  detail      VARCHAR(200),
  metadata    JSONB NOT NULL DEFAULT '{}',
  is_primary  BOOLEAN NOT NULL DEFAULT FALSE,
  is_paused   BOOLEAN NOT NULL DEFAULT FALSE,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  expires_at  TIMESTAMPTZ NOT NULL,
  renewed_count SMALLINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_intent_active_type ON user_intents(user_id, type) WHERE status='active';
CREATE UNIQUE INDEX uq_intent_primary     ON user_intents(user_id) WHERE is_primary AND status='active';
CREATE INDEX idx_intent_lookup ON user_intents(type, status, expires_at) WHERE status='active' AND NOT is_paused;
CREATE INDEX idx_intent_expiry ON user_intents(expires_at) WHERE status='active';

CREATE TABLE intent_complementarity (          -- seeded, remote-config overridable
  from_type intent_type NOT NULL,
  to_type   intent_type NOT NULL,
  weight    NUMERIC(3,2) NOT NULL CHECK (weight BETWEEN 0 AND 1),
  PRIMARY KEY (from_type, to_type)
);

CREATE TABLE inbound_intent_filters (
  user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  accepted_intents   intent_type[] ,               -- NULL = accept all
  min_experience_years NUMERIC(4,1),
  max_experience_years NUMERIC(4,1),
  industry_ids       INT[],
  verified_only      BOOLEAN NOT NULL DEFAULT FALSE,
  max_inbound_per_day INT CHECK (max_inbound_per_day BETWEEN 1 AND 200),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════ AVAILABILITY (§10.3.9, §16.4) ═══════════════
CREATE TYPE availability_state AS ENUM
  ('available_now','busy','away','invisible','offline','scheduled');

-- availability_schedules is created before availability_sessions, which
-- references it (schedule_id).
CREATE TABLE availability_schedules (
  id            UUID PRIMARY KEY DEFAULT public.uuidv7(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_at      TIMESTAMPTZ NOT NULL,
  duration_minutes INT NOT NULL CHECK (duration_minutes BETWEEN 15 AND 240),
  timezone      TEXT NOT NULL,                    -- IANA, for DST-correct expansion
  rrule         TEXT,                             -- NULL = one-off
  until_at      TIMESTAMPTZ,
  reminder_minutes_before INT DEFAULT 10,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sched_user_active ON availability_schedules(user_id) WHERE is_active;

CREATE TABLE availability_sessions (
  id              UUID PRIMARY KEY DEFAULT public.uuidv7(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state           availability_state NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ,                        -- NULL for busy/invisible/offline
  ended_at        TIMESTAMPTZ,
  end_reason      TEXT CHECK (end_reason IN
                    ('expired','manual','superseded','disconnected','admin','profile_private')),
  duration_minutes    INT CHECK (duration_minutes BETWEEN 1 AND 240),
  extensions_used     SMALLINT NOT NULL DEFAULT 0 CHECK (extensions_used <= 3),
  note                VARCHAR(120),
  schedule_id         UUID REFERENCES availability_schedules(id) ON DELETE SET NULL,
  source              TEXT,                            -- onboarding | manual | schedule | convene_hours | reminder
  matches_viewed      INT NOT NULL DEFAULT 0,
  requests_sent       INT NOT NULL DEFAULT 0,
  conversations_started INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Exactly one live session per user
CREATE UNIQUE INDEX uq_avail_active_per_user
  ON availability_sessions(user_id) WHERE ended_at IS NULL;
CREATE INDEX idx_avail_live_expiry
  ON availability_sessions(expires_at)
  WHERE ended_at IS NULL AND state = 'available_now';
CREATE INDEX idx_avail_user_time ON availability_sessions(user_id, started_at DESC);

CREATE TABLE availability_session_intents (
  session_id UUID REFERENCES availability_sessions(id) ON DELETE CASCADE,
  intent_id  UUID REFERENCES user_intents(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, intent_id)
);

-- Live availability, refreshed continuously by trigger-maintained table (not
-- a real MV, which cannot be refreshed cheaply enough). §16.4.
CREATE TABLE availability_live (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state       availability_state NOT NULL,
  session_id  UUID,
  expires_at  TIMESTAMPTZ,
  intent_ids  UUID[],
  geohash_5   CHAR(5),
  city_id     INT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_al_state_geo ON availability_live(state, geohash_5) WHERE state='available_now';
CREATE INDEX idx_al_state_city ON availability_live(state, city_id);

-- ═══════════════ CONNECTIONS (§10.6.8) ═══════════════
CREATE TABLE connections (
  id           UUID PRIMARY KEY DEFAULT public.uuidv7(),
  user_a_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES users(id),
  intent_id    UUID REFERENCES user_intents(id) ON DELETE SET NULL,
  match_score  SMALLINT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at   TIMESTAMPTZ,
  removed_by   UUID REFERENCES users(id),
  CONSTRAINT chk_pair_order CHECK (user_a_id < user_b_id),
  CONSTRAINT chk_no_self CHECK (user_a_id <> user_b_id)
);
CREATE UNIQUE INDEX uq_connection_pair ON connections(user_a_id, user_b_id) WHERE removed_at IS NULL;
CREATE INDEX idx_conn_a ON connections(user_a_id) WHERE removed_at IS NULL;
CREATE INDEX idx_conn_b ON connections(user_b_id) WHERE removed_at IS NULL;

CREATE TYPE request_status AS ENUM ('pending','accepted','rejected','cancelled','expired');

CREATE TABLE connection_requests (
  id            UUID PRIMARY KEY DEFAULT public.uuidv7(),
  sender_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  intent_id     UUID REFERENCES user_intents(id) ON DELETE SET NULL,
  note          VARCHAR(300),
  match_score   SMALLINT,
  match_reasons JSONB,
  source        TEXT,
  status        request_status NOT NULL DEFAULT 'pending',
  is_queued     BOOLEAN NOT NULL DEFAULT FALSE,       -- held by recipient throttle
  responded_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '14 days'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_no_self_request CHECK (sender_id <> recipient_id)
);
CREATE UNIQUE INDEX uq_pending_request ON connection_requests(sender_id, recipient_id) WHERE status='pending';
CREATE INDEX idx_req_recipient ON connection_requests(recipient_id, status, match_score DESC);
CREATE INDEX idx_req_expiry ON connection_requests(expires_at) WHERE status='pending';

CREATE TABLE blocks (
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT chk_no_self_block CHECK (blocker_id <> blocked_id)
);
CREATE INDEX idx_blocks_blocked ON blocks(blocked_id);

CREATE TABLE match_suppressions (            -- "not interested" / instant-chat exits
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  suppressed_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason        TEXT,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '90 days'),
  PRIMARY KEY (user_id, suppressed_id)
);

-- ═══════════════ MESSAGING (§10.7.7) ═══════════════
CREATE TABLE conversations (
  id              UUID PRIMARY KEY DEFAULT public.uuidv7(),
  connection_id   UUID REFERENCES connections(id) ON DELETE SET NULL,
  type            TEXT NOT NULL DEFAULT 'direct' CHECK (type IN ('direct','instant')),
  state           TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','frozen','archived')),
  last_message_at TIMESTAMPTZ,
  message_seq     BIGINT NOT NULL DEFAULT 0,        -- per-conversation monotonic counter
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conversation_participants (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unread_count    INT NOT NULL DEFAULT 0,
  last_read_seq   BIGINT NOT NULL DEFAULT 0,
  is_pinned       BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived     BOOLEAN NOT NULL DEFAULT FALSE,
  muted_until     TIMESTAMPTZ,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX idx_cp_user_list ON conversation_participants(user_id, is_archived, is_pinned DESC);

CREATE TYPE message_type AS ENUM ('text','image','file','voice','system','scheduling');

-- Monthly partitions are NOT created here — scripts/create-partitions.ts
-- provisions them (current + 3 months ahead), matching the P2.3 prompt's
-- separation of "table structure" (migration) from "partition provisioning"
-- (scheduled job). Run that script once after this migration before any
-- message can be inserted.
CREATE TABLE messages (
  id               UUID NOT NULL DEFAULT public.uuidv7(),
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id        UUID NOT NULL REFERENCES users(id),
  client_msg_id    UUID NOT NULL,
  sequence         BIGINT NOT NULL,
  type             message_type NOT NULL DEFAULT 'text',
  body             TEXT CHECK (char_length(body) <= 4000),
  reply_to_id      UUID,
  attachments      JSONB NOT NULL DEFAULT '[]',
  metadata         JSONB NOT NULL DEFAULT '{}',      -- transcript, waveform, link preview, slots
  edited_at        TIMESTAMPTZ,
  edit_count       SMALLINT NOT NULL DEFAULT 0,
  deleted_at       TIMESTAMPTZ,
  deleted_scope    TEXT CHECK (deleted_scope IN ('everyone')),
  moderation_state TEXT NOT NULL DEFAULT 'pending'
                   CHECK (moderation_state IN ('pending','clean','flagged','retracted')),
  search_vector    TSVECTOR,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE UNIQUE INDEX uq_msg_client ON messages(conversation_id, client_msg_id, created_at);
CREATE UNIQUE INDEX uq_msg_seq    ON messages(conversation_id, sequence, created_at);
CREATE INDEX idx_msg_conv_seq     ON messages(conversation_id, sequence DESC);
CREATE INDEX idx_msg_search       ON messages USING GIN (search_vector);

CREATE TABLE message_reactions (
  message_id UUID NOT NULL, created_at_ref TIMESTAMPTZ NOT NULL,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id)
);
CREATE TABLE message_hides (                    -- delete-for-me
  message_id UUID NOT NULL, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, user_id)
);
CREATE TABLE message_edits (
  message_id UUID NOT NULL, version SMALLINT NOT NULL, body TEXT NOT NULL,
  edited_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (message_id, version)
);

-- ═══════════════ NOTIFICATIONS (§10.8) ═══════════════
CREATE TABLE notifications (
  id           UUID PRIMARY KEY DEFAULT public.uuidv7(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category     TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT,
  data         JSONB NOT NULL DEFAULT '{}',       -- deep_link, actor_id, entity_id
  collapse_key TEXT,
  priority     TEXT NOT NULL DEFAULT 'medium',
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_user_unread ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE UNIQUE INDEX uq_notif_collapse ON notifications(user_id, collapse_key)
  WHERE collapse_key IS NOT NULL AND read_at IS NULL;
