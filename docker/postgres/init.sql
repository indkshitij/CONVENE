-- Runs once, on first container init, before any application migration.
-- PostGIS ships pre-created in the postgis/postgis base image; the rest are
-- created explicitly here so a fresh database always has all five ready.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
