import { describe, expect, it } from "vitest";
import { adminOnly } from "./admin-only.policy";

describe("adminOnly", () => {
  it('always allows (the real gate is @Roles("admin") via RolesGuard)', () => {
    expect(adminOnly()).toBe(true);
  });
});
