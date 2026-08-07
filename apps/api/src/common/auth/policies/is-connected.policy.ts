// PRD §10.6: two users may message/view details once their connection has
// been accepted — "pending" and "declined"/"none" are not sufficient.
export type ConnectionStatus = "none" | "pending" | "connected" | "declined" | "blocked";

export function isConnected(status: ConnectionStatus): boolean {
  return status === "connected";
}
