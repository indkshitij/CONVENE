DROP TABLE IF EXISTS matching_weight_configs;
ALTER TABLE feed_impressions DROP COLUMN IF EXISTS score_band;
ALTER TABLE feed_impressions DROP COLUMN IF EXISTS expansion_stage;
