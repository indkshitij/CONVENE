-- PRD §16.3 IDENTITY. Extensions are also provisioned by docker/postgres/init.sql
-- for the docker-compose stack; declared here too (IF NOT EXISTS) so this
-- migration is self-sufficient against any Postgres 16 instance.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Postgres 16 has no native UUIDv7 generator (added upstream only in
-- Postgres 18) — PRD §16.3 asks for uuidv7() shipped in the migration
-- itself. Schema-qualified so this never collides with (or ambiguously
-- resolves against) a server that already ships pg_catalog.uuidv7()
-- natively. Timestamp (48 bits, ms) + 74 bits of randomness, version/variant
-- bits set per RFC 9562.
CREATE OR REPLACE FUNCTION public.uuidv7() RETURNS uuid AS $$
DECLARE
  unix_ts_ms bytea;
  uuid_bytes bytea;
BEGIN
  unix_ts_ms := substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3 FOR 6);
  uuid_bytes := unix_ts_ms || gen_random_bytes(10);
  uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & 15) | 112); -- version 7
  uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & 63) | 128); -- variant 10
  RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- ═══════════════ IDENTITY ═══════════════
CREATE TYPE user_status AS ENUM
  ('pending_verification','active','restricted','shadow_limited','suspended','deleted');
CREATE TYPE user_role   AS ENUM ('user','recruiter','admin','moderator','support');

CREATE TABLE users (
  id                  UUID PRIMARY KEY DEFAULT public.uuidv7(),
  email               CITEXT UNIQUE,
  phone               VARCHAR(20) UNIQUE,
  password_hash       TEXT,                              -- NULL for OAuth-only
  full_name           VARCHAR(80) NOT NULL,
  date_of_birth       DATE NOT NULL,
  email_verified_at   TIMESTAMPTZ,
  phone_verified_at   TIMESTAMPTZ,
  status              user_status NOT NULL DEFAULT 'pending_verification',
  role                user_role   NOT NULL DEFAULT 'user',
  onboarding_step     SMALLINT NOT NULL DEFAULT 1,
  onboarding_completed_at TIMESTAMPTZ,
  terms_version       TEXT NOT NULL,
  last_active_at      TIMESTAMPTZ,
  name_change_count   SMALLINT NOT NULL DEFAULT 0,
  deletion_requested_at TIMESTAMPTZ,
  purge_at            TIMESTAMPTZ,
  attribution         JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_contact CHECK (email IS NOT NULL OR phone IS NOT NULL),
  CONSTRAINT chk_adult   CHECK (date_of_birth <= (CURRENT_DATE - INTERVAL '18 years'))
);
CREATE INDEX idx_users_status_active ON users(status, last_active_at DESC) WHERE status='active';
CREATE INDEX idx_users_purge ON users(purge_at) WHERE purge_at IS NOT NULL;

CREATE TABLE auth_identities (
  id            UUID PRIMARY KEY DEFAULT public.uuidv7(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL CHECK (provider IN ('google','linkedin','apple')),
  provider_uid  TEXT NOT NULL,
  email         CITEXT,
  linked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);

CREATE TABLE refresh_tokens (
  id           UUID PRIMARY KEY DEFAULT public.uuidv7(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id    UUID NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  device_fingerprint TEXT NOT NULL,
  parent_id    UUID REFERENCES refresh_tokens(id),
  used_at      TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rt_family ON refresh_tokens(family_id) WHERE revoked_at IS NULL;
