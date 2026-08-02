-- PRD §16.3 PROFILE and GEOGRAPHY REFERENCE. Extensions are also provisioned
-- by docker/postgres/init.sql; declared here too (IF NOT EXISTS) so this
-- migration is self-sufficient against any Postgres 16 instance.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE visibility      AS ENUM ('public','authenticated','connections_only','matches_only','private');
CREATE TYPE loc_privacy     AS ENUM ('exact','city_only','country_only','hidden');
CREATE TYPE remote_pref     AS ENUM ('onsite','hybrid','remote','any');
CREATE TYPE employment_type AS ENUM ('full_time','part_time','contract','freelance',
                                     'self_employed','student','unemployed','founder');

-- ═══════════════ GEOGRAPHY REFERENCE ═══════════════
-- (created before PROFILE so profiles.city_id resolves)
CREATE TABLE countries (code CHAR(2) PRIMARY KEY, name TEXT NOT NULL, default_timezone TEXT);
CREATE TABLE states  (id SERIAL PRIMARY KEY, country_code CHAR(2) REFERENCES countries(code),
                      name TEXT NOT NULL, UNIQUE (country_code, name));
CREATE TABLE cities  (id SERIAL PRIMARY KEY, state_id INT REFERENCES states(id),
                      country_code CHAR(2) REFERENCES countries(code),
                      name TEXT NOT NULL, population INT,
                      centroid GEOGRAPHY(POINT,4326), timezone TEXT NOT NULL);
CREATE INDEX idx_cities_name ON cities USING GIN (name gin_trgm_ops);
CREATE INDEX idx_cities_centroid ON cities USING GIST (centroid);

-- NOT GIVEN EXPLICIT DDL IN THE PRD: `profiles.industry_id` references
-- industries(id), and P2.5's seed script seeds "~80 industries with
-- adjacency," but no CREATE TABLE for it appears anywhere in §16.3. Assumed
-- minimal shape (name + a self-referencing adjacency array), flagged here
-- rather than guessed silently — revisit if a fuller spec surfaces later.
CREATE TABLE industries (
  id                    SERIAL PRIMARY KEY,
  name                  TEXT NOT NULL UNIQUE,
  slug                  TEXT NOT NULL UNIQUE,
  adjacent_industry_ids INT[] NOT NULL DEFAULT '{}'
);

-- media is referenced by profiles (avatar_media_id, resume_media_id) — must
-- exist first. DDL is PRD §16.3, "REPUTATION, MEDIA, BILLING" section (only
-- `media` belongs to this migration; reputation_scores/plans/subscriptions
-- are P2.4).
CREATE TABLE media (
  id           UUID PRIMARY KEY DEFAULT public.uuidv7(),
  owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('avatar','message_image','message_file','voice','resume','export')),
  storage_key  TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  size_bytes   BIGINT NOT NULL,
  width INT, height INT, duration_ms INT,
  derivatives  JSONB NOT NULL DEFAULT '{}',
  perceptual_hash TEXT,
  moderation_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (moderation_state IN ('pending','clean','rejected','quarantined')),
  av_scan_state TEXT NOT NULL DEFAULT 'pending',
  committed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_media_gc ON media(created_at) WHERE committed_at IS NULL;
CREATE INDEX idx_media_phash ON media(perceptual_hash) WHERE kind='avatar';

-- ═══════════════ PROFILE ═══════════════
CREATE TABLE profiles (
  user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  headline           VARCHAR(120) NOT NULL,
  about              TEXT CHECK (char_length(about) <= 2000),
  avatar_media_id    UUID REFERENCES media(id) ON DELETE SET NULL,
  resume_media_id    UUID REFERENCES media(id) ON DELETE SET NULL,
  industry_id        INT REFERENCES industries(id),
  job_title          VARCHAR(100) NOT NULL,
  company_name       VARCHAR(100),
  company_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  employment_type    employment_type,
  years_experience   NUMERIC(4,1) NOT NULL DEFAULT 0 CHECK (years_experience BETWEEN 0 AND 60),
  years_experience_override BOOLEAN NOT NULL DEFAULT FALSE,
  social_links       JSONB NOT NULL DEFAULT '{}',
  city_id            INT REFERENCES cities(id),
  coordinates        GEOGRAPHY(POINT, 4326),            -- field-encrypted at rest
  geohash_5          CHAR(5),
  geohash_3          CHAR(3),
  timezone           TEXT NOT NULL,
  location_source    TEXT CHECK (location_source IN ('gps','manual','ip')),
  location_updated_at TIMESTAMPTZ,
  location_privacy   loc_privacy NOT NULL DEFAULT 'city_only',
  profile_visibility visibility  NOT NULL DEFAULT 'public',
  search_radius_km   INT NOT NULL DEFAULT 25 CHECK (search_radius_km BETWEEN 1 AND 500),
  auto_expand_radius BOOLEAN NOT NULL DEFAULT TRUE,
  remote_preference  remote_pref NOT NULL DEFAULT 'any',
  open_to_relocate   BOOLEAN NOT NULL DEFAULT FALSE,
  relocate_city_ids  INT[],
  verification_level SMALLINT NOT NULL DEFAULT 0 CHECK (verification_level BETWEEN 0 AND 4),
  profile_completion SMALLINT NOT NULL DEFAULT 0,
  search_vector      TSVECTOR,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_prof_coords    ON profiles USING GIST (coordinates);
CREATE INDEX idx_prof_geohash5  ON profiles (geohash_5) WHERE location_privacy <> 'hidden';
CREATE INDEX idx_prof_city      ON profiles (city_id, profile_completion DESC);
CREATE INDEX idx_prof_industry  ON profiles (industry_id, years_experience);
CREATE INDEX idx_prof_search    ON profiles USING GIN (search_vector);
CREATE INDEX idx_prof_discoverable ON profiles (profile_completion)
  WHERE profile_visibility IN ('public','authenticated') AND profile_completion >= 40;

CREATE TABLE profile_embeddings (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  embedding   VECTOR(1024) NOT NULL,
  source_hash TEXT NOT NULL,                   -- hash of the text used, for cache invalidation
  model       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_emb_hnsw ON profile_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE TABLE skills (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(50) NOT NULL UNIQUE,
  slug         VARCHAR(50) NOT NULL UNIQUE,
  functional_area TEXT,                        -- engineering | data | design | product | growth | sales | finance | ops | legal
  aliases      TEXT[],
  embedding    VECTOR(1024),
  usage_count  INT NOT NULL DEFAULT 0,
  is_approved  BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE user_skills (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id    INT  NOT NULL REFERENCES skills(id),
  proficiency TEXT CHECK (proficiency IN ('beginner','intermediate','advanced','expert')),
  years       NUMERIC(3,1),
  position    SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, skill_id)
);
CREATE INDEX idx_us_skill ON user_skills(skill_id);

-- NOT GIVEN EXPLICIT DDL IN THE PRD: §10.2.2 lists `interests[]` (join,
-- <=15) as a matching input, and P2.5 seeds "~150 interests," but no
-- CREATE TABLE appears in §16.3. Modelled on the skills/user_skills pattern
-- (the closest table the PRD does specify), flagged as an assumption.
CREATE TABLE interests (
  id   SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  slug VARCHAR(50) NOT NULL UNIQUE
);
CREATE TABLE user_interests (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  interest_id INT  NOT NULL REFERENCES interests(id),
  position    SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, interest_id)
);

-- NOT GIVEN EXPLICIT DDL IN THE PRD: §10.2.2 lists `languages[]` (join,
-- <=8), P2.5 seeds "~60 languages." ISO 639-1 code as the natural key,
-- proficiency following the same enum shape as verification_level's ladder.
-- Flagged as an assumption.
CREATE TABLE languages (
  code TEXT PRIMARY KEY,   -- ISO 639-1, e.g. 'en', 'hi'
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE user_languages (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language_code TEXT NOT NULL REFERENCES languages(code),
  proficiency   TEXT CHECK (proficiency IN ('basic','conversational','fluent','native')),
  position      SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, language_code)
);

CREATE TABLE experiences (
  id          UUID PRIMARY KEY DEFAULT public.uuidv7(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_name VARCHAR(100) NOT NULL,
  title       VARCHAR(100) NOT NULL,
  employment_type employment_type,
  location_text VARCHAR(120),
  start_date  DATE NOT NULL,
  end_date    DATE,
  is_current  BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT CHECK (char_length(description) <= 1200),
  position    SMALLINT NOT NULL DEFAULT 0,
  CONSTRAINT chk_dates CHECK (end_date IS NULL OR end_date > start_date),
  CONSTRAINT chk_current CHECK ((is_current AND end_date IS NULL) OR NOT is_current)
);
CREATE INDEX idx_exp_user ON experiences(user_id, start_date DESC);

-- education, certifications, portfolio_items: PRD §16.3 states these "follow
-- the same pattern: UUID pk, user_id FK CASCADE, position ordering, length
-- CHECKs" without full DDL. Fields below come from §10.2.2's field spec
-- (education <=8, certifications <=15 with issuer/dates/credential URL,
-- portfolio <=12) and the onboarding example in §10.1
-- ({school, degree, field}). Flagged as an assumption, not a transcription.
CREATE TABLE education (
  id             UUID PRIMARY KEY DEFAULT public.uuidv7(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school         VARCHAR(150) NOT NULL,
  degree         VARCHAR(100),
  field_of_study VARCHAR(100),
  start_date     DATE,
  end_date       DATE,
  description    TEXT CHECK (char_length(description) <= 500),
  position       SMALLINT NOT NULL DEFAULT 0,
  CONSTRAINT chk_edu_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date > start_date)
);
CREATE INDEX idx_edu_user ON education(user_id, position);

CREATE TABLE certifications (
  id             UUID PRIMARY KEY DEFAULT public.uuidv7(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           VARCHAR(150) NOT NULL,
  issuer         VARCHAR(150) NOT NULL,
  issued_at      DATE,
  expires_at     DATE,
  credential_url TEXT CHECK (credential_url IS NULL OR credential_url LIKE 'https://%'),
  position       SMALLINT NOT NULL DEFAULT 0,
  CONSTRAINT chk_cert_dates CHECK (expires_at IS NULL OR issued_at IS NULL OR expires_at > issued_at)
);
CREATE INDEX idx_cert_user ON certifications(user_id, position);

CREATE TABLE portfolio_items (
  id          UUID PRIMARY KEY DEFAULT public.uuidv7(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       VARCHAR(150) NOT NULL,
  url         TEXT NOT NULL CHECK (url LIKE 'https://%'),
  description TEXT CHECK (char_length(description) <= 500),
  media_id    UUID REFERENCES media(id) ON DELETE SET NULL,
  position    SMALLINT NOT NULL DEFAULT 0
);
CREATE INDEX idx_portfolio_user ON portfolio_items(user_id, position);
