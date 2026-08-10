import * as SecureStore from "expo-secure-store";

// §18.8: "expo-secure-store for tokens." Mobile has no BFF/httpOnly-cookie
// layer the way apps/web does (design.md §18.1's own "the refresh token
// lives only in an httpOnly cookie handled by BFF routes" is a web-only
// mechanism) — the access/refresh tokens apps/api issues are stored here
// instead, in the OS keychain/keystore SecureStore wraps, and attached to
// every request by lib/api/client.ts directly.
const ACCESS_TOKEN_KEY = "convene.access_token";
const REFRESH_TOKEN_KEY = "convene.refresh_token";

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken),
  ]);
}

export async function loadTokens(): Promise<StoredTokens | null> {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  ]);
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
  ]);
}
