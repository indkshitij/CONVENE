import { describe, expect, it } from "vitest";
import { FUNCTIONAL_AREAS, INDUSTRIES, INTERESTS, LANGUAGES, SKILLS } from "./taxonomies";

describe("taxonomies seed data (P2.5)", () => {
  it("has roughly 400 skills across all nine functional areas", () => {
    expect(SKILLS.length).toBeGreaterThanOrEqual(350);
    const areasUsed = new Set(SKILLS.map((s) => s.functionalArea));
    expect(areasUsed.size).toBe(FUNCTIONAL_AREAS.length);
  });

  it("has unique skill names and slugs", () => {
    expect(new Set(SKILLS.map((s) => s.name)).size).toBe(SKILLS.length);
    expect(new Set(SKILLS.map((s) => s.slug)).size).toBe(SKILLS.length);
  });

  it("has roughly 80 industries, each with valid adjacency references", () => {
    expect(INDUSTRIES.length).toBeGreaterThanOrEqual(70);
    const validSlugs = new Set(INDUSTRIES.map((i) => i.slug));
    for (const industry of INDUSTRIES) {
      for (const adjacent of industry.adjacentSlugs) {
        expect(validSlugs.has(adjacent)).toBe(true);
      }
      expect(industry.adjacentSlugs).not.toContain(industry.slug);
    }
  });

  it("has roughly 150 unique interests", () => {
    expect(INTERESTS.length).toBeGreaterThanOrEqual(130);
    expect(new Set(INTERESTS).size).toBe(INTERESTS.length);
  });

  it("has roughly 60 unique languages", () => {
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(50);
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(LANGUAGES.length);
  });
});
