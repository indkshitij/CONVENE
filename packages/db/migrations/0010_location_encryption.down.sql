ALTER TABLE profiles DROP CONSTRAINT chk_prof_pinned_tier;
ALTER TABLE profiles DROP COLUMN pinned_tier;
ALTER TABLE profiles DROP COLUMN coordinates_encrypted;
