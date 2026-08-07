-- P5.3: refresh_tokens gains the columns the session-list endpoint
-- (§10.1.7 endpoint 9: "GET /auth/sessions -> {sessions:[{id,device,
-- ip_country,last_active_at,current}]}") needs to render a human-readable
-- device and coarse location per session. §10.1.8 names "users 1-N
-- sessions" without ever giving `sessions` its own DDL anywhere in §16.3 —
-- the closest existing 1-N-per-device table is refresh_tokens (already
-- carries family_id/device_fingerprint/used_at/revoked_at), so a "session"
-- is modelled as one refresh-token family rather than introducing a
-- parallel table with no PRD-given shape. `last_active_at` doesn't need a
-- new column: MAX(created_at) across a family's rows already advances on
-- every rotation.
ALTER TABLE refresh_tokens ADD COLUMN device_label TEXT;
ALTER TABLE refresh_tokens ADD COLUMN ip_country CHAR(2);
