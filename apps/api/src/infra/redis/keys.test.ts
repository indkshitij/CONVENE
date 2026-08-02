import { describe, expect, it } from "vitest";
import { idempotencyKey, rateLimitKey } from "./keys";

// P3.3: keys.ts is the single place any Redis key string is constructed,
// version-prefixed so a deploy can invalidate a whole class of keys.
describe("idempotencyKey", () => {
  it("is version-prefixed", () => {
    expect(idempotencyKey("/test/create", "abc")).toMatch(/^v1:/);
  });

  it("includes both the route and the idempotency key header value", () => {
    const key = idempotencyKey("/test/create", "abc-123");
    expect(key).toBe("v1:idempotency:/test/create:abc-123");
  });

  it("produces distinct keys for distinct routes or header values", () => {
    const a = idempotencyKey("/test/create", "same-key");
    const b = idempotencyKey("/test/other", "same-key");
    const c = idempotencyKey("/test/create", "different-key");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("rateLimitKey", () => {
  it("is version-prefixed and namespaced under rate-limit", () => {
    expect(rateLimitKey("messages-per-user", "user=abc")).toBe(
      "v1:rate-limit:messages-per-user:user=abc",
    );
  });

  it("produces distinct keys for distinct scopes or composite key parts", () => {
    const a = rateLimitKey("messages-per-user", "user=abc");
    const b = rateLimitKey("messages-per-conversation", "user=abc");
    const c = rateLimitKey("messages-per-user", "user=xyz");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
