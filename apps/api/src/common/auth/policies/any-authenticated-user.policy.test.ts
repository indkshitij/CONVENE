import { describe, expect, it } from "vitest";
import { anyAuthenticatedUser } from "./any-authenticated-user.policy";

describe("anyAuthenticatedUser", () => {
  it("always allows (the real check happens inside the service)", () => {
    expect(anyAuthenticatedUser()).toBe(true);
  });
});
