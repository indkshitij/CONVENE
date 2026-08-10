-- P12.3 / §11.11: "Record impressions with the expansion stage and score
-- band" for the fairness audit query — §16.3's own feed_impressions DDL
-- (migrations/0003) has neither column.
ALTER TABLE feed_impressions ADD COLUMN expansion_stage SMALLINT;
ALTER TABLE feed_impressions ADD COLUMN score_band TEXT;

-- P12.3 / AD-8: "Matching weights live in remote config ... every change
-- written to audit_logs and rejected unless the weights sum to 1.00."
-- No DDL for this is given anywhere in the PRD (§11 only states the
-- *requirement* that weights be remotely configurable and auditable, AD-8
-- names Flagsmith as the mechanism) — this table is the Postgres-backed
-- default RemoteConfigProvider implementation (mirrors P5.1's
-- LocalFileKeyProvider precedent: a real Flagsmith-backed provider
-- implements the same interface in production without callers changing).
-- Only one row may be active at a time; a rejected proposal never reaches
-- this table at all (see matching-weights-provider.ts) — "the previous
-- config remains active" holds by construction, not a rollback step.
CREATE TABLE matching_weight_configs (
  id          UUID PRIMARY KEY DEFAULT public.uuidv7(),
  weights     JSONB NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT FALSE,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_matching_weight_configs_active
  ON matching_weight_configs (is_active)
  WHERE is_active;
