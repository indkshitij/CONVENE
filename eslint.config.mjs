import { defineConfig, globalIgnores } from "eslint/config";
import baseConfig from "./packages/config/eslint.base.mjs";

// Editor/root-level fallback only. Each workspace member (apps/*, packages/*)
// owns its own eslint.config.mjs and is linted independently via its own
// `pnpm --filter <name> lint` script, invoked through `turbo run lint`.
export default defineConfig([
  ...baseConfig,
  globalIgnores(["apps/**", "packages/**", "**/dist/**", "**/.next/**", "**/.turbo/**"]),
]);
