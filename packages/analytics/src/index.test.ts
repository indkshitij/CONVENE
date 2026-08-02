import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("@convene/analytics", () => {
  it("exposes its package identity", () => {
    expect(PACKAGE_NAME).toBe("@convene/analytics");
  });
});
