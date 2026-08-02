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

function findForbiddenFieldNames(
  sourceText: string,
  fileName: string,
  forbidden: string,
): string[] {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === forbidden
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      violations.push(`${fileName}:${line + 1}`);
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
describe("no response DTO structurally includes a coordinates field", () => {
  it("detects a deliberately-bad fixture (proves the scanner works)", () => {
    const badSource = `
      export class BadLocationDto {
        userId: string;
        coordinates: { lat: number; lng: number };
      }
    `;
    const violations = findForbiddenFieldNames(badSource, "fixture.dto.ts", "coordinates");
    expect(violations).toHaveLength(1);
  });

  it("does not flag a clean fixture", () => {
    const goodSource = `
      export class GoodLocationDto {
        userId: string;
        cityName: string;
        distanceBucketKm: number;
      }
    `;
    const violations = findForbiddenFieldNames(goodSource, "fixture.dto.ts", "coordinates");
    expect(violations).toHaveLength(0);
  });

  it("scans every *.controller.ts and *.dto.ts file actually in the repo", () => {
    const modulesDir = join(__dirname, "..", "modules");
    const files = findControllerAndDtoFiles(modulesDir);
    const allViolations = files.flatMap((file) =>
      findForbiddenFieldNames(readFileSync(file, "utf8"), file, "coordinates"),
    );

    expect(allViolations).toEqual([]);
  });
});
