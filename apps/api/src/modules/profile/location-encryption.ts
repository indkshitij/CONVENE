import { sql, type SQL } from "drizzle-orm";
import { InternalAppError } from "../../common/errors/app-error";

// See migrations/0010_location_encryption.sql for why this column exists
// alongside the plaintext, query-path `coordinates` column. Same
// optional-env-var-with-clear-runtime-error precedent as the OAuth
// providers (google-oauth.provider.ts) — LOCATION_ENCRYPTION_KEY isn't
// required at boot, but a location update can't proceed without it.
export function requireLocationEncryptionKey(key: string | undefined): string {
  if (!key) {
    throw new InternalAppError(
      "INTERNAL_ERROR",
      "Location updates are not configured on this server (LOCATION_ENCRYPTION_KEY missing).",
    );
  }
  return key;
}

// pgp_sym_encrypt takes the plaintext and key as bound parameters (never
// string-interpolated) — both flow through drizzle's sql`` tag, which
// parameterises them exactly like any other query value.
export function encryptedPointSql(latitude: number, longitude: number, key: string): SQL {
  const wkt = `POINT(${longitude} ${latitude})`;
  return sql`pgp_sym_encrypt(${wkt}, ${key})`;
}
