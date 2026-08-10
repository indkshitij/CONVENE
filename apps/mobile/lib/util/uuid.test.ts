import { describe, expect, it } from "vitest";
import { randomUuid } from "./uuid";

describe("randomUuid", () => {
  it("produces a v4-shaped uuid", () => {
    expect(randomUuid()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("is unique across calls (client_msg_id must never collide within a device)", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => randomUuid()));
    expect(ids.size).toBe(1000);
  });
});
