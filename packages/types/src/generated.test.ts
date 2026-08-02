import { describe, expect, it } from "vitest";
import type { paths } from "./generated";

// Type-level smoke test: a known path/method/response shape from
// openapi/convene.v1.yaml. If a future spec edit drops or renames one of
// these, this file fails to *typecheck* (not to run) — the same mechanism
// scripts/generate-types.ts --check exists for, just caught locally too.
type RegisterResponse =
  paths["/auth/register"]["post"]["responses"]["201"]["content"]["application/json"];
type DiscoverResponse =
  paths["/discover"]["get"]["responses"]["200"]["content"]["application/json"];
type ErrorEnvelope =
  paths["/auth/register"]["post"]["responses"]["400"]["content"]["application/json"]["error"];

const _typeAssertions: [RegisterResponse, DiscoverResponse, ErrorEnvelope] = [
  {},
  { data: [], meta: { next_cursor: null, has_more: false } },
  { code: "x", message: "x", field: null, details: null, request_id: "018f...", retry_after: null },
];
void _typeAssertions;

describe("generated types", () => {
  it("compiles (this file's real assertion is the typecheck itself)", () => {
    expect(true).toBe(true);
  });
});
