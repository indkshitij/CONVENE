import { describe, expect, it } from "vitest";
import {
  CURSOR_TTL_MS,
  decodeCursor,
  encodeCursor,
  isCursorExpired,
  isPastCursorBoundary,
  type FeedCursor,
} from "./cursor";

const baseCursor: FeedCursor = {
  score: 72,
  id: "user-1",
  expansionStage: 1,
  filterHash: "abc123",
  generatedAt: "2026-08-08T00:00:00.000Z",
};

describe("encodeCursor / decodeCursor", () => {
  it("round-trips exactly", () => {
    const token = encodeCursor(baseCursor);
    expect(decodeCursor(token)).toEqual(baseCursor);
  });

  it("produces an opaque (non-JSON-looking) token", () => {
    const token = encodeCursor(baseCursor);
    expect(token).not.toContain("{");
    expect(token).not.toContain("score");
  });

  it("returns null for garbage input rather than throwing", () => {
    expect(decodeCursor("not-a-real-cursor")).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });

  it("returns null for a well-formed base64 payload that isn't a FeedCursor shape", () => {
    const token = Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64url");
    expect(decodeCursor(token)).toBeNull();
  });
});

describe("isCursorExpired", () => {
  it("is not expired immediately after generation", () => {
    const now = new Date(baseCursor.generatedAt);
    expect(isCursorExpired(baseCursor, now)).toBe(false);
  });

  it("is not expired just under the 10-minute TTL", () => {
    const now = new Date(new Date(baseCursor.generatedAt).getTime() + CURSOR_TTL_MS - 1);
    expect(isCursorExpired(baseCursor, now)).toBe(false);
  });

  it("is expired just past the 10-minute TTL", () => {
    const now = new Date(new Date(baseCursor.generatedAt).getTime() + CURSOR_TTL_MS + 1);
    expect(isCursorExpired(baseCursor, now)).toBe(true);
  });

  it("treats an unparseable generatedAt as expired", () => {
    expect(isCursorExpired({ ...baseCursor, generatedAt: "not-a-date" }, new Date())).toBe(true);
  });
});

describe("isPastCursorBoundary", () => {
  it("a strictly lower score is past the boundary", () => {
    expect(isPastCursorBoundary(70, "user-1", baseCursor)).toBe(true);
  });

  it("a strictly higher score is not past the boundary", () => {
    expect(isPastCursorBoundary(75, "user-1", baseCursor)).toBe(false);
  });

  it("equal score with a greater id is past the boundary (tie-break)", () => {
    expect(isPastCursorBoundary(72, "user-2", baseCursor)).toBe(true);
  });

  it("equal score with a lesser or equal id is not past the boundary", () => {
    expect(isPastCursorBoundary(72, "user-0", baseCursor)).toBe(false);
    expect(isPastCursorBoundary(72, "user-1", baseCursor)).toBe(false);
  });
});
