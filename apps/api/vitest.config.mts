import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    // The boot test spawns a real child process (tsx + Nest bootstrap).
    testTimeout: 15_000,
  },
});
