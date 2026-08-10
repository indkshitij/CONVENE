import { z } from "zod";

// PRD §21.5: "Configuration is environment variables validated by a Zod
// schema at boot; the process refuses to start if any required variable is
// missing or malformed." REDIS_URL joins DATABASE_URL as required now that
// P3.3 wires Redis (idempotency store, rate limiting in P3.4, health probe).
// S3/JWT secrets get added by the modules that actually need them, not
// speculatively here.
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // PRD §17.4/P5.1: "Signing keys from a KMS abstraction (local file
  // provider in dev)." Production points this at a KMS-backed KeyProvider
  // implementation instead; this path is only ever read by the local-file
  // dev provider.
  JWKS_KEYS_PATH: z.string().default(".keys/jwks-keys.json"),
  // PRD §10.1.7 endpoint 10 / P5.5: Google and LinkedIn OAuth. Optional —
  // most dev/test environments never configure real provider credentials;
  // the OAuth module throws a clear error at call time (not at boot) if a
  // route needing a specific provider's credentials is hit without them.
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  LINKEDIN_OAUTH_CLIENT_ID: z.string().optional(),
  LINKEDIN_OAUTH_CLIENT_SECRET: z.string().optional(),
  // PRD §10.5.2/P9.1: pgcrypto field-level encryption for
  // profiles.coordinates_encrypted (see migrations/0010's own comment for
  // why this coexists with the plaintext, GIST-indexed coordinates
  // column). Optional for the same reason as the OAuth secrets above —
  // location.service.ts throws a clear error at call time if a location
  // update is attempted without it configured, rather than failing boot
  // for every dev/test env that hasn't set one up.
  LOCATION_ENCRYPTION_KEY: z.string().min(32).optional(),
  // PRD §17.7: "S3-compatible object storage." No cloud storage account
  // exists in this codebase's dev/test environment — same "local provider
  // now, real backend later, same interface" precedent as JWKS_KEYS_PATH
  // above (P16.1's StorageProvider). Both default rather than being
  // required/optional-with-runtime-throw: a real production deployment
  // swaps STORAGE_PROVIDER for an S3-backed implementation entirely
  // (this local one is dev/test scaffolding, same as JWKS_KEYS_PATH's own
  // default), so there's no meaningful "unconfigured in prod" state to
  // guard against the way LOCATION_ENCRYPTION_KEY's optional secret does.
  MEDIA_STORAGE_ROOT: z.string().default(".media-storage"),
  MEDIA_SIGNING_SECRET: z
    .string()
    .min(32)
    .default("dev-only-media-signing-secret-not-for-production-use"),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration — ${details}`);
  }
  return result.data;
}
