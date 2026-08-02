import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("@convene/types", () => {
  it("exposes its package identity", () => {
    expect(PACKAGE_NAME).toBe("@convene/types");
  });
});
