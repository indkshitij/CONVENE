import { createHash } from "node:crypto";

// PRD P7.4 / BR-PROF-09 — "compose embedding text from headline, about,
// job title, skills and industry." Pure and DB-free so it's independently
// testable; embedding.service.ts is the half that actually fetches these
// fields from Postgres.
export interface EmbeddingSourceFields {
  headline: string | null;
  about: string | null;
  jobTitle: string | null;
  industry: string | null;
  skills: string[];
}

export function composeEmbeddingText(fields: EmbeddingSourceFields): string {
  return [fields.headline, fields.jobTitle, fields.industry, fields.about, fields.skills.join(", ")]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part)
    .join("\n");
}

// BR-PROF-09's entire cost-control mechanism: recomputation is skipped
// whenever this hash is unchanged from the stored profile_embeddings row,
// so the (potentially paid) provider.embed() call never runs for an
// unrelated profile edit. SHA-256 over the composed text, not a weaker
// hash — collisions here would silently suppress a real embedding update.
export function hashSourceText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
