import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's `"@/*": ["./*"]` — Vitest (Vite) doesn't
    // read tsconfig `paths` on its own, so every `@/...` import used
    // across lib/providers/stores needs the equivalent alias here too.
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test-setup.ts"],
    // tests/e2e/** are Playwright specs (playwright.config.ts), run via
    // `pnpm test:e2e` — Vitest's default include glob would otherwise
    // also try to run them as unit tests and fail on `test.describe`'s
    // async-callback usage, which only Playwright's runner supports.
    exclude: ["**/node_modules/**", "**/.git/**", "tests/e2e/**"],
  },
});
