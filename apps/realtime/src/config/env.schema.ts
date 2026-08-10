import { z } from "zod";

// PRD §21.5: config validated by Zod at boot, same convention as apps/api
// (apps/api/src/config/env.schema.ts). Deliberately its own schema, not a
// shared package import — this is a separate deployable with its own
// (smaller) config surface, not a module of the API.
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8081),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  // Base URL of the apps/api deployment this gateway trusts for WS ticket
  // verification — GET {API_BASE_URL}/.well-known/jwks.json (§17.4). Not a
  // shared DB/file-based KeyProvider on purpose: the gateway is a
  // separately deployable, horizontally-scaled service (§17.5's "any
  // replica can serve any user"), so it verifies tickets the same way any
  // external RS256 consumer would — over the public JWKS endpoint.
  API_BASE_URL: z.string().min(1, "API_BASE_URL is required"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
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
