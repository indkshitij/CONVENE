-- P5.2: auth session security primitives §17.4/§10.1.8, plus an expand
-- fix for a real registration/schema mismatch found while implementing
-- this phase.
--
-- Bug: profiles.headline, profiles.job_title and profiles.timezone were
-- created NOT NULL in 0001_profile_geo.sql, but the PRD's own onboarding
-- wizard (§10.1.3) collects headline/job_title at Step 2 and timezone at
-- Step 5 (location) — Step 1 (registration) only has email/phone,
-- password, full_name and date_of_birth. P5.2's explicit requirement is
-- "a profiles row is created in the same transaction as the users row" at
-- registration, which is impossible while these columns are NOT NULL with
-- no default. Relaxing them is an expand (backward-compatible) change.
ALTER TABLE profiles ALTER COLUMN headline DROP NOT NULL;
ALTER TABLE profiles ALTER COLUMN job_title DROP NOT NULL;
ALTER TABLE profiles ALTER COLUMN timezone DROP NOT NULL;

-- PRD §17.4: "token_version" (tv claim) — bumped on refresh-token reuse
-- detection to invalidate every outstanding access token for that user.
ALTER TABLE users ADD COLUMN token_version INT NOT NULL DEFAULT 0;

-- PRD §17.4 / §10.1.8: "Email/phone OTP: 6-digit, Argon2id-hashed,
-- 10-minute TTL, 5 attempts then invalidate." Append-only: each send
-- creates a new row; the most recent non-consumed, non-expired row for
-- (user_id, channel) is the active challenge, so resend-rate and cooldown
-- windows can be computed from row history without a separate counter.
CREATE TABLE otp_challenges (
  id          UUID PRIMARY KEY DEFAULT public.uuidv7(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL CHECK (channel IN ('email', 'phone')),
  code_hash   TEXT NOT NULL,
  attempts    SMALLINT NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_otp_challenges_active ON otp_challenges (user_id, channel, created_at DESC);

-- PRD §10.1.8: "verification_tokens." Single-use signed tokens; only
-- email_verify is needed for P5.2's scope (password-reset tokens are
-- added by the phase that implements that endpoint — expand/contract
-- discipline, not invented ahead of need).
CREATE TABLE verification_tokens (
  id         UUID PRIMARY KEY DEFAULT public.uuidv7(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('email_verify')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_verification_tokens_user ON verification_tokens (user_id, type);
