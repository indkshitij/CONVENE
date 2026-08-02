import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    // Testcontainers integration tests pull/start a real Postgres container.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
