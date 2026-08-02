#!/usr/bin/env node
// PRD §17.9 / P4.4: generates packages/types/src/generated.ts from
// openapi/convene.v1.yaml so client and server types can never drift. Pass
// --check to verify the committed output is up to date without writing
// (used by CI — see .github/workflows/ci.yml).
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const specPath = join(rootDir, "openapi", "convene.v1.yaml");
const outputPath = join(rootDir, "packages", "types", "src", "generated.ts");
const binPath = join(rootDir, "node_modules", ".bin", "openapi-typescript");

const checkMode = process.argv.includes("--check");

const args = [specPath, "-o", outputPath];
if (checkMode) args.push("--check");

execFileSync(binPath, args, {
  cwd: rootDir,
  stdio: "inherit",
});
