ALTER TABLE users DROP COLUMN IF EXISTS name_change_window_started_at;

DROP TRIGGER IF EXISTS trg_user_interests_search_vector ON user_interests;
DROP TRIGGER IF EXISTS trg_user_skills_search_vector ON user_skills;
DROP TRIGGER IF EXISTS trg_profiles_search_vector ON profiles;

DROP FUNCTION IF EXISTS trg_profile_search_vector_from_user_id_table();
DROP FUNCTION IF EXISTS trg_profile_search_vector_from_profiles();
DROP FUNCTION IF EXISTS update_profile_search_vector(UUID);
