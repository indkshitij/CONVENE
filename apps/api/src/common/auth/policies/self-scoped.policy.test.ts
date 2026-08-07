import { describe, expect, it } from "vitest";
import { selfScoped } from "./self-scoped.policy";

describe("selfScoped", () => {
  it("always allows (the resource query itself is already scoped to the caller)", () => {
    expect(selfScoped()).toBe(true);
  });
});
