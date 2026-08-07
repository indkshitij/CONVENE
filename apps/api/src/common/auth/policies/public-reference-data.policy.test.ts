import { describe, expect, it } from "vitest";
import { publicReferenceData } from "./public-reference-data.policy";

describe("publicReferenceData", () => {
  it("always allows (shared reference data has no per-resource owner)", () => {
    expect(publicReferenceData()).toBe(true);
  });
});
