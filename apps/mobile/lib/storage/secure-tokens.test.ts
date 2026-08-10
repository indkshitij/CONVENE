import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

vi.mock("expo-secure-store", () => ({
  setItemAsync: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  }),
  getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
  deleteItemAsync: vi.fn(async (key: string) => {
    store.delete(key);
  }),
}));

import { clearTokens, loadTokens, saveTokens } from "./secure-tokens";

describe("secure-tokens", () => {
  beforeEach(() => {
    store.clear();
  });

  it("round-trips saved tokens", async () => {
    await saveTokens({ accessToken: "access-1", refreshToken: "refresh-1" });
    expect(await loadTokens()).toEqual({ accessToken: "access-1", refreshToken: "refresh-1" });
  });

  it("returns null when either token is missing (never a half-populated pair)", async () => {
    await saveTokens({ accessToken: "access-1", refreshToken: "refresh-1" });
    store.delete("convene.refresh_token");
    expect(await loadTokens()).toBeNull();
  });

  it("returns null when nothing was ever saved", async () => {
    expect(await loadTokens()).toBeNull();
  });

  it("clears both tokens", async () => {
    await saveTokens({ accessToken: "access-1", refreshToken: "refresh-1" });
    await clearTokens();
    expect(await loadTokens()).toBeNull();
  });
});
