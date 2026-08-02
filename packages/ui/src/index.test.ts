import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("@convene/ui", () => {
  it("exposes its package identity", () => {
    expect(PACKAGE_NAME).toBe("@convene/ui");
  });
});
