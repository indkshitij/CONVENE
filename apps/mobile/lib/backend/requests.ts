import { apiFetch } from "./client";

// Mirrors apps/web's RequestCard/RequestsListResponse (apps/api's
// connections.controller.ts) — GET /connections/requests,
// POST .../accept, POST .../reject.
export interface RequestCard {
  id: string;
  status: "pending" | "accepted" | "rejected" | "cancelled" | "expired";
  sender_id: string;
  recipient_id: string;
  intent: { id: string; type: string; detail: string | null } | null;
  note: string | null;
  created_at: string;
  expires_at: string;
}

export interface RequestsListResponse {
  requests: RequestCard[];
  next_cursor: string | null;
}

export function getReceivedRequests(accessToken: string): Promise<RequestsListResponse> {
  return apiFetch<RequestsListResponse>("/connections/requests?direction=received&status=pending", {
    accessToken,
  });
}

export function acceptRequest(
  accessToken: string,
  id: string,
): Promise<{ connection: { id: string }; conversation: { id: string } }> {
  return apiFetch(`/connections/requests/${id}/accept`, { method: "POST", accessToken });
}

export function rejectRequest(accessToken: string, id: string): Promise<void> {
  return apiFetch<void>(`/connections/requests/${id}/reject`, { method: "POST", accessToken });
}
