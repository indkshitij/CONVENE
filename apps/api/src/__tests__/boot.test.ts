import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const apiRoot = join(__dirname, "..", "..");

// PRD §21.5 / P3.1 acceptance: "a boot test asserting the process exits
// non-zero when DATABASE_URL is absent." Spawns the real entry point in a
// child process — main.ts calls process.exit() on failure, which would
// kill the test runner itself if imported in-process instead.
// A valid REDIS_URL is supplied alongside DATABASE_URL in the
// DATABASE_URL-focused cases below so each test isolates the one variable
// it's about — otherwise these would pass vacuously the moment REDIS_URL
// also became required (P3.3).
const VALID_REDIS_URL = "redis://localhost:6379";

describe("API boot (config validation)", () => {
  it("exits non-zero when DATABASE_URL is missing", () => {
    const { DATABASE_URL: _omitted, ...rest } = process.env;
    const { status } = spawnSync("npx", ["tsx", "src/main.ts"], {
      cwd: apiRoot,
      env: { ...rest, REDIS_URL: VALID_REDIS_URL },
      timeout: 10_000,
      encoding: "utf8",
    });

    expect(status).not.toBe(0);
  });

  it("exits non-zero when DATABASE_URL is malformed (empty string)", () => {
    const { status } = spawnSync("npx", ["tsx", "src/main.ts"], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: "", REDIS_URL: VALID_REDIS_URL },
      timeout: 10_000,
      encoding: "utf8",
    });

    expect(status).not.toBe(0);
  });

  it("exits non-zero when REDIS_URL is missing", () => {
    const { REDIS_URL: _omitted, ...rest } = process.env;
    const { status } = spawnSync("npx", ["tsx", "src/main.ts"], {
      cwd: apiRoot,
      env: { ...rest, DATABASE_URL: "postgres://convene:convene@localhost:5432/convene" },
      timeout: 10_000,
      encoding: "utf8",
    });

    expect(status).not.toBe(0);
  });
});
