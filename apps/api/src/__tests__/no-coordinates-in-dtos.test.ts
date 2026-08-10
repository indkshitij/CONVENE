import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

function findControllerAndDtoFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...findControllerAndDtoFiles(full));
    } else if (/\.(controller|dto)\.ts$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

// P29.2 security review: the original scanner only checked for a
// property literally named `coordinates` — a DTO with top-level
// `latitude`/`longitude`/`lat`/`lng` fields (not nested under a
// `coordinates` object) would pass undetected. No file in the repo
// currently has such fields (this test's third case proves that), but
// the scanner itself was under-covering what T3 (§20.1: "Stalking via
// location... coordinates never leave the server") actually requires —
// widened to the full set of names a raw-coordinate field could
// plausibly be spelled.
const FORBIDDEN_FIELD_NAMES = ["coordinates", "latitude", "longitude", "lat", "lng"] as const;

function findForbiddenFieldNames(
  sourceText: string,
  fileName: string,
  forbidden: readonly string[],
): string[] {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  const forbiddenSet = new Set(forbidden);

  function visit(node: ts.Node): void {
    if (
      (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      forbiddenSet.has(node.name.text)
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      violations.push(`${fileName}:${line + 1} (${node.name.text})`);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

// PRD §17.9 acceptance: "a repository-wide test that walks every registered
// route's response DTO type and fails if any of them structurally includes
// a coordinates field." No controllers/DTOs exist yet (P3.1/P3.2 scope is
// the skeleton and shared primitives) — the fixture tests prove the scanner
// itself works; the live scan starts doing real work the moment the first
// *.controller.ts / *.dto.ts is added in a later phase.
describe("no response DTO structurally includes a raw-coordinate field", () => {
  it("detects a deliberately-bad fixture nesting coordinates under an object (proves the scanner works)", () => {
    const badSource = `
      export class BadLocationDto {
        userId: string;
        coordinates: { lat: number; lng: number };
      }
    `;
    const violations = findForbiddenFieldNames(badSource, "fixture.dto.ts", FORBIDDEN_FIELD_NAMES);
    // Flags both `coordinates` itself AND the nested `lat`/`lng` inside it.
    expect(violations).toHaveLength(3);
  });

  it("detects top-level latitude/longitude fields, not just a nested `coordinates` object", () => {
    const badSource = `
      export class BadFlatLocationDto {
        userId: string;
        latitude: number;
        longitude: number;
      }
    `;
    const violations = findForbiddenFieldNames(badSource, "fixture.dto.ts", FORBIDDEN_FIELD_NAMES);
    expect(violations).toHaveLength(2);
  });

  it("does not flag a clean fixture", () => {
    const goodSource = `
      export class GoodLocationDto {
        userId: string;
        cityName: string;
        distanceBucketKm: number;
      }
    `;
    const violations = findForbiddenFieldNames(goodSource, "fixture.dto.ts", FORBIDDEN_FIELD_NAMES);
    expect(violations).toHaveLength(0);
  });

  it("does not false-positive on unrelated fields that merely contain a forbidden substring (e.g. `translation`, `flag`)", () => {
    const goodSource = `
      export class GoodMiscDto {
        translation: string;
        flag: boolean;
      }
    `;
    const violations = findForbiddenFieldNames(goodSource, "fixture.dto.ts", FORBIDDEN_FIELD_NAMES);
    expect(violations).toHaveLength(0);
  });

  it("scans every *.controller.ts and *.dto.ts file actually in the repo", () => {
    const modulesDir = join(__dirname, "..", "modules");
    const files = findControllerAndDtoFiles(modulesDir);
    const allViolations = files.flatMap((file) =>
      findForbiddenFieldNames(readFileSync(file, "utf8"), file, FORBIDDEN_FIELD_NAMES),
    );

    expect(allViolations).toEqual([]);
  });
});
