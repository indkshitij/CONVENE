import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { LoginInput, UserResponse } from "../backend/auth";
import * as authApi from "../backend/auth";
import { clearTokens, loadTokens, saveTokens } from "../storage/secure-tokens";

// §18.8's "auth working end to end" — the one piece of session state
// every screen in (tabs) needs, and the one gate (auth)/_layout.tsx and
// (tabs)/_layout.tsx both check before rendering their own children.
// Deliberately mirrors apps/web's Session/getSession() shape (lib/auth/session.ts)
// even though the storage mechanism is completely different (SecureStore
// vs. an httpOnly cookie) — same session concept, same two fields.
export interface Session {
  user: UserResponse;
  accessToken: string;
}

interface AuthResultLike {
  user: UserResponse;
  tokens: { access_token: string; refresh_token: string };
}

interface AuthContextValue {
  session: Session | null;
  // `true` means "still restoring from SecureStore," distinct from a
  // `null` session ("restored, definitely signed out") — the root
  // layout uses this to hold the splash screen instead of flashing a
  // login screen before the stored session has even been read.
  isRestoring: boolean;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
  setSessionFromAuthResult: (result: AuthResultLike) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);

  // Restoring a full session on cold start needs a `user` object too,
  // but SecureStore only ever holds tokens (see saveTokens()'s own
  // shape) — a real restore would need either persisting the user
  // object alongside the tokens or a `GET /auth/me` endpoint to
  // re-fetch it, neither of which exists yet. Documented reduced-scope
  // gap for this phase: session restore across app restarts isn't
  // wired up, only the in-memory session set by a fresh login/signup
  // within the current app run. Flagged rather than faked with a
  // placeholder user object.
  useEffect(() => {
    void loadTokens().then(() => {
      setIsRestoring(false);
    });
  }, []);

  const setSessionFromAuthResult = useCallback(async (result: AuthResultLike) => {
    await saveTokens({
      accessToken: result.tokens.access_token,
      refreshToken: result.tokens.refresh_token,
    });
    setSession({ user: result.user, accessToken: result.tokens.access_token });
  }, []);

  const login = useCallback(
    async (input: LoginInput) => {
      const result = await authApi.login(input);
      await setSessionFromAuthResult(result);
    },
    [setSessionFromAuthResult],
  );

  const logout = useCallback(async () => {
    const tokens = await loadTokens();
    if (tokens) {
      await authApi.logout(tokens.refreshToken).catch(() => undefined);
    }
    await clearTokens();
    setSession(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ session, isRestoring, login, logout, setSessionFromAuthResult }),
    [session, isRestoring, login, logout, setSessionFromAuthResult],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth() must be called within an AuthProvider");
  return context;
}
