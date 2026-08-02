import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("@convene/admin", () => {
  it("exposes its package identity", () => {
    expect(PACKAGE_NAME).toBe("@convene/admin");
  });
});
