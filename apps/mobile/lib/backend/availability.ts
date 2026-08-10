import { apiFetch } from "./client";

// Mirrors apps/web/lib/api/client.ts's SessionResponse/AvailabilityMeResponse/
// CreateSessionResult (apps/api's availability.service.ts) — same wire
// contract on both platforms.
export interface SessionResponse {
  id: string;
  state: string;
  started_at: string;
  expires_at: string | null;
  duration_minutes: number | null;
  extensions_used: number;
  extensions_remaining: number;
  note: string | null;
  session_intents: { id: string; type: string }[];
}

export interface AvailabilityMeResponse {
  current_session: SessionResponse | null;
}

export interface CreateSessionInput {
  state: "available_now" | "busy" | "away" | "invisible";
  duration_minutes?: number;
  note?: string;
  session_intent_ids?: string[];
}

export interface CreateSessionResult {
  session: SessionResponse;
  match_preview: {
    available_now_count: number;
    nearby_count: number;
    top_score: number | null;
  } | null;
}

export function getCurrentAvailability(accessToken: string): Promise<AvailabilityMeResponse> {
  return apiFetch<AvailabilityMeResponse>("/availability/me", { accessToken });
}

export function createAvailabilitySession(
  accessToken: string,
  input: CreateSessionInput,
): Promise<CreateSessionResult> {
  return apiFetch<CreateSessionResult>("/availability/sessions", {
    method: "POST",
    accessToken,
    body: input,
  });
}

export function endAvailabilitySession(accessToken: string, sessionId: string): Promise<void> {
  return apiFetch<void>(`/availability/sessions/${sessionId}`, { method: "DELETE", accessToken });
}
