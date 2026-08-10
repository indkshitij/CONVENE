import { apiFetch } from "./client";

// apps/api's POST /realtime/ticket (realtime-ticket.service.ts) — unlike
// apps/web (whose access token is httpOnly and needs a server-side BFF
// route to reach this endpoint at all), mobile already holds its own
// access token directly, so this is a normal authenticated call, no
// proxy needed.
export interface WsTicketResponse {
  ticket: string;
  expires_in: number;
}

export function getRealtimeTicket(accessToken: string): Promise<WsTicketResponse> {
  return apiFetch<WsTicketResponse>("/realtime/ticket", { method: "POST", accessToken });
}
