import { describe, expect, it } from "vitest";
import { isSelf } from "./is-self.policy";

describe("isSelf", () => {
  it("returns true when the ids match", () => {
    expect(isSelf("user-1", "user-1")).toBe(true);
  });

  it("returns false when the ids differ", () => {
    expect(isSelf("user-1", "user-2")).toBe(false);
  });
});
