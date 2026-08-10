-- P10.3 / §10.3.8: `POST /availability/schedules` accepts
-- `session_intent_ids` in its request body, but §10.3.9's own DDL for
-- availability_schedules has no column or join table for it — a PRD
-- gap. Denormalized as a plain array here, mirroring the precedent
-- availability_live.intent_ids already set in migrations/0002 rather
-- than introducing a new join table for a single array field.
ALTER TABLE availability_schedules ADD COLUMN session_intent_ids UUID[];
