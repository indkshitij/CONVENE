import { defineConfig } from "vitest/config";

// CLAUDE.md rule 8 / P4.2 acceptance: "packages/matching ... require 100%
// coverage" — enforced here so a coverage regression fails CI, not just a
// number someone has to remember to check.
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
