-- P9.3 / §10.5.6: "CREATE INDEX idx_profiles_country_tz ON profiles
-- (country_code, timezone)" — stage 4 of the radius-expansion strategy
-- (same country_code) needs this as a direct, indexed column; profiles
-- only carries city_id today, with country reachable solely via a join
-- through cities. Denormalized here (backfilled from the existing
-- city_id relationship) purely so this specific index can exist and be
-- used directly, the same tradeoff geohash_5/geohash_3 already make for
-- proximity queries.
ALTER TABLE profiles ADD COLUMN country_code CHAR(2) REFERENCES countries(code);

UPDATE profiles p
SET country_code = c.country_code
FROM cities c
WHERE p.city_id = c.id AND p.country_code IS NULL;

CREATE INDEX idx_prof_country_tz ON profiles (country_code, timezone);
