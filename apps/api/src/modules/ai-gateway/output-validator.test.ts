import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validateAiOutput } from "./output-validator";

const schema = z.object({ headline: z.string(), suggestions: z.array(z.string()).max(3) });

describe("validateAiOutput", () => {
  it("rejects malformed JSON outright — never attempts a partial parse", () => {
    const result = validateAiOutput(schema, "{ headline: not valid json");
    expect(result).toEqual({ ok: false, reason: "INVALID_JSON" });
  });

  it("rejects JSON that doesn't match the schema — never coerces or drops the offending field", () => {
    const result = validateAiOutput(
      schema,
      JSON.stringify({ headline: "ok", suggestions: "not an array" }),
    );
    expect(result).toEqual({ ok: false, reason: "SCHEMA_MISMATCH" });
  });

  it("a strict schema rejects extra, unexpected top-level keys that could smuggle instructions", () => {
    const strictSchema = z.object({ headline: z.string() }).strict();
    const result = validateAiOutput(
      strictSchema,
      JSON.stringify({ headline: "ok", tool_call: "delete_everything" }),
    );
    expect(result).toEqual({ ok: false, reason: "SCHEMA_MISMATCH" });
  });

  it("accepts a well-formed match and returns the typed data", () => {
    const result = validateAiOutput(
      schema,
      JSON.stringify({ headline: "ok", suggestions: ["a", "b"] }),
    );
    expect(result).toEqual({ ok: true, data: { headline: "ok", suggestions: ["a", "b"] } });
  });
});
