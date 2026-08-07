-- P5.5: password/reset (§10.1.7 endpoint 8) reuses the same single-use
-- signed-token mechanism email verification already uses
-- (verification_tokens, migrations/0004_auth_session_security.sql) —
-- expand its CHECK constraint to allow the new type rather than adding a
-- parallel table, per the expand/contract discipline this codebase has
-- followed since P5.2 (see verification-tokens.ts's own header comment,
-- which flagged this exact expansion ahead of time).
-- The original CHECK in 0004 was declared inline with no explicit name,
-- so Postgres auto-generated "verification_tokens_type_check" — that's
-- the name that actually exists, not a hand-chosen one.
ALTER TABLE verification_tokens DROP CONSTRAINT verification_tokens_type_check;
ALTER TABLE verification_tokens ADD CONSTRAINT verification_tokens_type_check
  CHECK (type IN ('email_verify', 'password_reset'));
