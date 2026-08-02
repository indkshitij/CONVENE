import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// PRD §11.5.2 — "the full 14x14 intent_complementarity matrix ... loaded
// from a checked-in fixture." Source of truth is fixtures/intent-complementarity.json;
// this module just loads, validates, and flattens it for insertion.
const INTENT_TYPES = [
  "looking_for_job",
  "hiring",
  "need_cofounder",
  "need_mentor",
  "need_mentee",
  "internship",
  "freelancer",
  "startup_discussion",
  "ai_collaboration",
  "business_networking",
  "coffee_chat",
  "learning",
  "investment_discussion",
  "partnerships",
] as const;

export type IntentType = (typeof INTENT_TYPES)[number];

export type ComplementarityRow = {
  fromType: IntentType;
  toType: IntentType;
  weight: number;
};

function loadFixture(): Record<string, Record<string, number>> {
  const fixturePath = join(
    dirname(fileURLToPath(import.meta.url)),
    "fixtures",
    "intent-complementarity.json",
  );
  const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
  const { _comment: _ignored, ...matrix } = raw;
  return matrix as Record<string, Record<string, number>>;
}

export function loadIntentComplementarity(): ComplementarityRow[] {
  const matrix = loadFixture();
  const rows: ComplementarityRow[] = [];

  for (const fromType of INTENT_TYPES) {
    const row = matrix[fromType];
    if (!row) {
      throw new Error(`intent-complementarity.json is missing row "${fromType}"`);
    }
    for (const toType of INTENT_TYPES) {
      const weight = row[toType];
      if (typeof weight !== "number") {
        throw new Error(`intent-complementarity.json is missing entry [${fromType}][${toType}]`);
      }
      if (weight < 0 || weight > 1) {
        throw new Error(
          `intent-complementarity.json entry [${fromType}][${toType}] = ${weight} is outside [0, 1]`,
        );
      }
      rows.push({ fromType, toType, weight });
    }
  }

  return rows;
}
