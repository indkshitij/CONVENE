-- P7.3: verification ladder (§10.2.5) — L3 work-email flow and L4
-- government-ID/third-party KYC flow (endpoint 16, POST /me/verification/*).
--
-- L1 (email) and L2 (phone) already exist via otp_challenges
-- (migrations/0004_auth_session_security.sql) plus users.email_verified /
-- users.phone_verified — nothing new needed for those two levels.
--
-- L3 (work email) reuses the same single-use signed-token mechanism as
-- email_verify/password_reset (expand/contract discipline, same precedent
-- as 0006_password_reset_tokens.sql), but a work-email code is sent to an
-- address that is NOT necessarily users.email — the table has no existing
-- concept of a target distinct from the owning user, so a nullable
-- `target` column is added alongside the type expansion.
ALTER TABLE verification_tokens DROP CONSTRAINT verification_tokens_type_check;
ALTER TABLE verification_tokens ADD CONSTRAINT verification_tokens_type_check
  CHECK (type IN ('email_verify', 'password_reset', 'work_email'));

ALTER TABLE verification_tokens ADD COLUMN target TEXT;

-- L4 (government ID / third-party KYC, §10.2.5 + §20.4): "ID images are
-- never stored by Convene; only the provider's verification reference and
-- result." No document data, no PII beyond what the provider reference
-- implies, ever stored here.
CREATE TABLE identity_verifications (
  id                  UUID PRIMARY KEY DEFAULT public.uuidv7(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL,
  provider_reference  TEXT NOT NULL,
  result              TEXT NOT NULL CHECK (result IN ('pending', 'approved', 'rejected')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_identity_verifications_user ON identity_verifications (user_id, created_at DESC);
