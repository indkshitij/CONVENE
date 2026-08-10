import type { auth as authValidation } from "@convene/validation";
import type { z } from "zod";
import { apiFetch } from "./client";

// Mirrors apps/api's UserResponse/TokensResponse (auth.service.ts) —
// same shapes apps/web/lib/api/client.ts hand-mirrors, kept in sync by
// hand for the same reason noted there: packages/types' generated
// OpenAPI types are still placeholder-only for auth operations.
export interface UserResponse {
  id: string;
  full_name: string;
  email: string | null;
  email_verified: boolean;
  onboarding_step: number;
  status: string;
  role: string;
}

export interface TokensResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  token_type: "Bearer";
}

export interface AuthResult {
  user: UserResponse;
  tokens: TokensResponse;
}

export interface RefreshResult {
  tokens: TokensResponse;
}

export type LoginInput = z.infer<typeof authValidation.loginSchema>;
export type RegisterInput = z.infer<typeof authValidation.registerSchema>;
export type OtpSendInput = z.infer<typeof authValidation.otpSendSchema>;
export type OtpVerifyInput = z.infer<typeof authValidation.otpVerifySchema>;

export function login(input: LoginInput): Promise<AuthResult> {
  return apiFetch<AuthResult>("/auth/login", { method: "POST", body: input });
}

export function register(input: RegisterInput): Promise<AuthResult> {
  return apiFetch<AuthResult>("/auth/register", { method: "POST", body: input });
}

export function sendOtp(input: OtpSendInput): Promise<{ sent: true }> {
  return apiFetch<{ sent: true }>("/auth/otp/send", { method: "POST", body: input });
}

export function verifyOtp(input: OtpVerifyInput): Promise<AuthResult> {
  return apiFetch<AuthResult>("/auth/otp/verify", { method: "POST", body: input });
}

export function refresh(refreshToken: string): Promise<RefreshResult> {
  return apiFetch<RefreshResult>("/auth/refresh", {
    method: "POST",
    refreshTokenCookie: refreshToken,
  });
}

export function logout(refreshToken: string): Promise<void> {
  return apiFetch<void>("/auth/logout", { method: "POST", refreshTokenCookie: refreshToken });
}
