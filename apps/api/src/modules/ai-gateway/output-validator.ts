import type { z } from "zod";

// §12.1: "Every feature declares a strict JSON output schema and a
// schema failure means rejection, never a partial or coerced result."
// This is the one place that rule is enforced — there is deliberately no
// "best effort" branch here: malformed JSON and schema mismatches both
// return the same rejected shape, never a partially-populated object.
export type AiOutputValidation<T> =
  { ok: true; data: T } | { ok: false; reason: "INVALID_JSON" | "SCHEMA_MISMATCH" };

export function validateAiOutput<T>(schema: z.ZodType<T>, raw: string): AiOutputValidation<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "INVALID_JSON" };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) return { ok: false, reason: "SCHEMA_MISMATCH" };
  return { ok: true, data: result.data };
}
