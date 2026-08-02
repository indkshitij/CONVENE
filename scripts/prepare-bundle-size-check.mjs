// Concatenates the files Next.js itself designates as shared across every
// route (`rootMainFiles` + `polyfillFiles` in `.next/build-manifest.json`)
// into one stable-named file. Turbopack's chunk filenames are content
// hashes with no semantic prefix, so a plain glob under `.next/static/chunks`
// can't distinguish the shared "shell" from per-route chunks — this script
// resolves that distinction once, up front, so `size-limit` (which only
// understands static paths/globs) can measure the shell precisely.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "web");
const manifestPath = join(webDir, ".next", "build-manifest.json");
const outDir = join(webDir, ".next", "analyze");
const outFile = join(outDir, "shell.js");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const shellFiles = [...(manifest.polyfillFiles ?? []), ...(manifest.rootMainFiles ?? [])];

const shellCode = shellFiles
  .map((relativePath) => readFileSync(join(webDir, ".next", relativePath), "utf8"))
  .join("\n");

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, shellCode);

console.log(`apps/web shell: ${shellFiles.length} files -> ${outFile}`);
