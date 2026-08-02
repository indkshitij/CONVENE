-- Reverses 0001_profile_geo.sql. Extensions (postgis, vector, pg_trgm) are
-- left in place — database-level provisioning, not owned by this migration.
DROP TABLE IF EXISTS portfolio_items;
DROP TABLE IF EXISTS certifications;
DROP TABLE IF EXISTS education;
DROP TABLE IF EXISTS experiences;
DROP TABLE IF EXISTS user_languages;
DROP TABLE IF EXISTS languages;
DROP TABLE IF EXISTS user_interests;
DROP TABLE IF EXISTS interests;
DROP TABLE IF EXISTS user_skills;
DROP TABLE IF EXISTS skills;
DROP TABLE IF EXISTS profile_embeddings;
DROP TABLE IF EXISTS profiles;
DROP TABLE IF EXISTS media;
DROP TABLE IF EXISTS industries;
DROP TABLE IF EXISTS cities;
DROP TABLE IF EXISTS states;
DROP TABLE IF EXISTS countries;
DROP TYPE IF EXISTS employment_type;
DROP TYPE IF EXISTS remote_pref;
DROP TYPE IF EXISTS loc_privacy;
DROP TYPE IF EXISTS visibility;
