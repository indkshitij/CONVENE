DROP INDEX IF EXISTS idx_verification_tokens_user;
DROP TABLE IF EXISTS verification_tokens;

DROP INDEX IF EXISTS idx_otp_challenges_active;
DROP TABLE IF EXISTS otp_challenges;

ALTER TABLE users DROP COLUMN IF EXISTS token_version;

ALTER TABLE profiles ALTER COLUMN timezone SET NOT NULL;
ALTER TABLE profiles ALTER COLUMN job_title SET NOT NULL;
ALTER TABLE profiles ALTER COLUMN headline SET NOT NULL;
