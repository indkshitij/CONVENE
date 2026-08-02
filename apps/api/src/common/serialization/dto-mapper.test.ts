import { describe, expect, it } from "vitest";
import { mapToDto } from "./dto-mapper";

interface FakeProfile {
  userId: string;
  headline: string;
  coordinates: string;
  internalNotes: string;
}

describe("mapToDto", () => {
  const entity: FakeProfile = {
    userId: "user-1",
    headline: "Building things",
    coordinates: "POINT(77.5946 12.9716)",
    internalNotes: "flagged for review",
  };

  it("picks only the whitelisted keys", () => {
    const dto = mapToDto(entity, ["userId", "headline"]);
    expect(dto).toEqual({ userId: "user-1", headline: "Building things" });
  });

  it("never includes keys outside the whitelist (no spreading)", () => {
    const dto = mapToDto(entity, ["userId"]);
    expect(dto).not.toHaveProperty("internalNotes");
    expect(dto).not.toHaveProperty("coordinates");
  });

  it("throws at runtime if 'coordinates' reaches the whitelist despite the type constraint", () => {
    // A caller could bypass the compile-time Exclude<..., "coordinates">
    // constraint with an `as any` cast; this proves the runtime guard
    // still catches it (defence in depth, PRD §17.9's "never serialise
    // coordinates" rule).
    const keys = ["userId", "coordinates"] as unknown as ["userId"];
    expect(() => mapToDto(entity, keys)).toThrow(/coordinates/);
  });
});
