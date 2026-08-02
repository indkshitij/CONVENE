-- Reverses 0000_identity.sql. Extensions (citext, pgcrypto) are left in
-- place — they're database-level provisioning shared with docker/postgres,
-- not owned by this migration's lifecycle.
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS auth_identities;
DROP TABLE IF EXISTS users;
DROP TYPE IF EXISTS user_role;
DROP TYPE IF EXISTS user_status;
DROP FUNCTION IF EXISTS public.uuidv7();
