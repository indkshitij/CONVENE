-- Reverses 0003_matching_safety_billing_audit.sql.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM convene_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES FROM convene_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM convene_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM convene_app;
REVOKE EXECUTE ON FUNCTION public.uuidv7() FROM convene_app;
REVOKE USAGE ON SCHEMA public FROM convene_app;
DROP ROLE IF EXISTS convene_app;

DROP MATERIALIZED VIEW IF EXISTS mutual_connection_counts;
DROP VIEW IF EXISTS connection_edges;

DROP TABLE IF EXISTS audit_logs_default;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS moderation_actions;
DROP TABLE IF EXISTS reports;

DROP TABLE IF EXISTS profile_views;
DROP TABLE IF EXISTS saved_searches;
DROP TABLE IF EXISTS user_settings;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS ai_usage_logs;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS plans;
DROP TABLE IF EXISTS reputation_scores;

DROP TABLE IF EXISTS feed_impressions;
DROP TABLE IF EXISTS match_candidates;
