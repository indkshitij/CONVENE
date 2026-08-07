-- P7.1: §10.9.2 "weighted tsvector (A name/headline, B job title/skills,
-- C company/interests, D about)" maintained by a trigger, per the P7.1
-- prompt's own instruction. Skills/interests live in join tables
-- (user_skills/skills, user_interests/interests), not columns on
-- profiles, so a single BEFORE-trigger-on-profiles design can't see them —
-- this uses a shared function plus triggers on all three tables that can
-- change the indexed text, each recomputing the full vector for the
-- affected user.
CREATE OR REPLACE FUNCTION update_profile_search_vector(p_user_id UUID) RETURNS void AS $$
DECLARE
  v_full_name TEXT;
BEGIN
  SELECT full_name INTO v_full_name FROM users WHERE id = p_user_id;

  UPDATE profiles p
  SET search_vector =
    setweight(to_tsvector('simple', coalesce(v_full_name, '') || ' ' || coalesce(p.headline, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(p.job_title, '') || ' ' || coalesce((
      SELECT string_agg(s.name, ' ') FROM user_skills us JOIN skills s ON s.id = us.skill_id WHERE us.user_id = p_user_id
    ), '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(p.company_name, '') || ' ' || coalesce((
      SELECT string_agg(i.name, ' ') FROM user_interests ui JOIN interests i ON i.id = ui.interest_id WHERE ui.user_id = p_user_id
    ), '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(p.about, '')), 'D')
  WHERE p.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- Only fires on the four indexed columns, and only ever writes
-- search_vector itself — so this can never re-trigger itself.
CREATE OR REPLACE FUNCTION trg_profile_search_vector_from_profiles() RETURNS trigger AS $$
BEGIN
  PERFORM update_profile_search_vector(NEW.user_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_search_vector
  AFTER INSERT OR UPDATE OF headline, about, job_title, company_name ON profiles
  FOR EACH ROW EXECUTE FUNCTION trg_profile_search_vector_from_profiles();

CREATE OR REPLACE FUNCTION trg_profile_search_vector_from_user_id_table() RETURNS trigger AS $$
BEGIN
  PERFORM update_profile_search_vector(COALESCE(NEW.user_id, OLD.user_id));
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_skills_search_vector
  AFTER INSERT OR UPDATE OR DELETE ON user_skills
  FOR EACH ROW EXECUTE FUNCTION trg_profile_search_vector_from_user_id_table();

CREATE TRIGGER trg_user_interests_search_vector
  AFTER INSERT OR UPDATE OR DELETE ON user_interests
  FOR EACH ROW EXECUTE FUNCTION trg_profile_search_vector_from_user_id_table();

-- BR-PROF-07: "Name changes are limited to 2 per 90 days." users.
-- name_change_count (migrations/0000_identity.sql) has no window-reset
-- mechanism on its own — this adds the window start so the limit is a
-- real rolling window: the count resets (to 1) whenever the most recent
-- change is more than 90 days after the window began, otherwise it
-- increments and is capped at 2 within the window.
ALTER TABLE users ADD COLUMN name_change_window_started_at TIMESTAMPTZ;
