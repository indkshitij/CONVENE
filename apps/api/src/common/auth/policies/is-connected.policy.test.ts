import { describe, expect, it } from "vitest";
import { isConnected } from "./is-connected.policy";

describe("isConnected", () => {
  it("is true only for 'connected'", () => {
    expect(isConnected("connected")).toBe(true);
  });

  it("is false for every other status", () => {
    expect(isConnected("none")).toBe(false);
    expect(isConnected("pending")).toBe(false);
    expect(isConnected("declined")).toBe(false);
    expect(isConnected("blocked")).toBe(false);
  });
});
