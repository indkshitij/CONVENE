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
