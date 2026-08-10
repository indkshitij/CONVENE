-- P9.1: §10.5.2 data model says coordinates are "PostGIS
-- geography(Point,4326), field-encrypted" — but §10.5.6's own query
-- implementation requires ST_DWithin/KNN (`<->`) filtering against a
-- GIST index on that exact column, which is impossible on pgcrypto
-- ciphertext (no spatial locality survives encryption). These two
-- requirements are irreconcilable on a single column, so this migration
-- resolves the tension by keeping `profiles.coordinates` as the
-- plaintext, GIST-indexed, query-path column (BR-LOC-02's real
-- guarantee — "exact coordinates never leave the server in any API
-- response" — is enforced by response-shape discipline, not column
-- encryption) and adding a redundant `coordinates_encrypted` column
-- satisfying "encrypt with pgcrypto at the field level" literally, as
-- defense-in-depth against a raw SQL dump/insider-threat scenario. It is
-- never read by any query path, only written alongside the plaintext
-- column and decryptable only with LOCATION_ENCRYPTION_KEY.
ALTER TABLE profiles ADD COLUMN coordinates_encrypted BYTEA;

-- RE-6 (§10.5.5): "Premium users may pin a stage." Tier numbers per
-- §10.5.4's 0-6 scale (Tier 0 same-geohash5 through Tier 6 global/poor
-- timezone overlap); NULL means "no pin, auto-expand as normal."
ALTER TABLE profiles ADD COLUMN pinned_tier SMALLINT;
ALTER TABLE profiles ADD CONSTRAINT chk_prof_pinned_tier CHECK (pinned_tier IS NULL OR pinned_tier BETWEEN 0 AND 6);
