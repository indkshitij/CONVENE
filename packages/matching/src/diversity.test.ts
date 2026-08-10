import { describe, expect, it } from "vitest";
import {
  DIVERSITY_CAPS,
  EXPLORATION_SLOT_POSITIONS,
  diversityInjection,
  type DiversityCandidate,
} from "./diversity";

function candidate(
  overrides: Partial<DiversityCandidate> & { id: string; score: number },
): DiversityCandidate {
  return {
    company: null,
    industry: null,
    primaryIntent: null,
    isNewUser: false,
    everShownToViewer: true,
    ...overrides,
  };
}

// PRD §11.8: "sort by (score DESC, ...)" happens before diversityInjection
// is ever called — these fixtures are pre-sorted descending, as the real
// caller (matching.service.ts) always provides.
function buildSameCompanyPool(count: number, company = "Acme"): DiversityCandidate[] {
  return Array.from({ length: count }, (_, i) =>
    candidate({ id: `c${i}`, score: 100 - i, company }),
  );
}

describe("diversityInjection", () => {
  it("caps candidates from the same company at 2 per page", () => {
    const pool = buildSameCompanyPool(30);
    const page = diversityInjection(pool, 20);

    const companyCount = page.filter((c) => c.company === "Acme").length;
    expect(companyCount).toBeLessThanOrEqual(DIVERSITY_CAPS.company);
  });

  it("caps candidates from the same industry at 8 per page", () => {
    const pool = Array.from({ length: 30 }, (_, i) =>
      candidate({ id: `c${i}`, score: 100 - i, industry: "tech", company: `company-${i}` }),
    );
    const page = diversityInjection(pool, 20);

    const industryCount = page.filter((c) => c.industry === "tech").length;
    expect(industryCount).toBeLessThanOrEqual(DIVERSITY_CAPS.industry);
  });

  it("caps candidates sharing the same primary intent at 10 per page", () => {
    const pool = Array.from({ length: 30 }, (_, i) =>
      candidate({
        id: `c${i}`,
        score: 100 - i,
        primaryIntent: "coffee_chat",
        company: `company-${i}`,
        industry: `industry-${i}`,
      }),
    );
    const page = diversityInjection(pool, 20);

    const intentCount = page.filter((c) => c.primaryIntent === "coffee_chat").length;
    expect(intentCount).toBeLessThanOrEqual(DIVERSITY_CAPS.intent);
  });

  it("never violates any cap, even at the exploration slots (positions 7 and 15)", () => {
    // A pool deliberately hostile to caps: every candidate shares the same
    // company AND a handful are flagged as "ideal explorers" so the
    // exploration-slot logic has real candidates to pick from.
    const pool = buildSameCompanyPool(40).map((c, i) =>
      i % 5 === 0 ? { ...c, isNewUser: true, everShownToViewer: false, score: 60 } : c,
    );
    const page = diversityInjection(pool, 20);

    const companyCount = page.filter((c) => c.company === "Acme").length;
    expect(companyCount).toBeLessThanOrEqual(DIVERSITY_CAPS.company);
  });

  it("holds diversity caps across three consecutive pages sliced from the same pool", () => {
    const pool = Array.from(
      { length: 90 },
      (_, i) => candidate({ id: `c${i}`, score: 100 - i, company: `company-${i % 3}` }), // only 3 distinct companies across the whole pool
    );

    for (let page = 0; page < 3; page++) {
      const slice = pool.slice(page * 30, page * 30 + 30);
      const result = diversityInjection(slice, 20);
      for (const company of new Set(slice.map((c) => c.company))) {
        expect(result.filter((c) => c.company === company).length).toBeLessThanOrEqual(
          DIVERSITY_CAPS.company,
        );
      }
    }
  });

  it("reserves positions 7 and 15 for exploration candidates when eligible ones exist", () => {
    const explorers = [
      candidate({ id: "explorer-1", score: 60, isNewUser: true, everShownToViewer: false }),
      candidate({ id: "explorer-2", score: 65, isNewUser: true, everShownToViewer: false }),
    ];
    const regulars = Array.from({ length: 20 }, (_, i) =>
      candidate({ id: `regular-${i}`, score: 90 - i }),
    );
    const pool = [...regulars, ...explorers];

    const page = diversityInjection(pool, 20);

    expect(EXPLORATION_SLOT_POSITIONS).toEqual([7, 15]);
    expect(page[6]!.id).toBe("explorer-1");
    expect(page[14]!.id).toBe("explorer-2");
  });

  it("leaves a page shorter than 7 untouched by exploration-slot logic", () => {
    const pool = Array.from({ length: 5 }, (_, i) => candidate({ id: `c${i}`, score: 100 - i }));
    const page = diversityInjection(pool, 20);
    expect(page).toHaveLength(5);
    expect(page.map((c) => c.id)).toEqual(["c0", "c1", "c2", "c3", "c4"]);
  });

  it("falls back to the next available candidate for an exploration slot when no ideal explorer exists", () => {
    const pool = Array.from({ length: 25 }, (_, i) =>
      candidate({ id: `c${i}`, score: 100 - i, company: `co-${i}` }),
    );
    const page = diversityInjection(pool, 20);
    // No isNewUser candidates anywhere — position 7 still gets filled from
    // the pool rather than being left as whatever fell there naturally
    // being silently skipped-over.
    expect(page).toHaveLength(20);
    expect(new Set(page.map((c) => c.id)).size).toBe(20); // no duplicates introduced
  });
});
