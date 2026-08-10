import { getRealtimeTicket } from "../backend/realtime";

// Mirrors apps/web's lib/realtime/socket.ts protocol exactly (confirmed
// against apps/realtime's own gateway, the real ground truth over the
// PRD's stale §10.7.5 prose) — plain JSON frames over a bare WebSocket,
// not Socket.IO (React Native's global `WebSocket` speaks this natively,
// no client library needed). §18.8/P27.2's "graceful socket death: fall
// back to push and reconcile on foreground via after_sequence" is this
// file's `subscribe()` (which always sends `after_sequence` once a
// sequence has been observed) plus the caller-driven reconcile in
// chat/[conversationId].tsx's AppState listener — this class only owns
// the connection lifecycle, not what "reconcile" means for a given
// screen.
const DEFAULT_WS_URL = "ws://localhost:8081/socket";
const PING_INTERVAL_MS = 25_000;

export type ConnectionStatus = "idle" | "connecting" | "open" | "closed";
export type SubscribeScope = "conversation" | "presence";

export interface RealtimeEventEnvelope {
  type: "event";
  channel: string;
  id?: string;
  sequence: number;
  event: string;
  payload: unknown;
}
type ServerFrame =
  RealtimeEventEnvelope | { type: "resync_required" } | { type: "error"; message: string };

function parseServerFrame(raw: string): ServerFrame | null {
  try {
    const parsed = JSON.parse(raw) as { type?: unknown };
    if (parsed.type === "event" || parsed.type === "resync_required" || parsed.type === "error")
      return parsed as ServerFrame;
    return null;
  } catch {
    return null;
  }
}

interface SubscriptionRecord {
  channel: SubscribeScope;
  id: string | undefined;
  lastSequence: number;
}

export interface RealtimeSocketOptions {
  accessToken: string;
  onEvent: (envelope: RealtimeEventEnvelope) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
  onResyncRequired?: () => void;
  wsUrl?: string;
}

export class RealtimeSocket {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = "idle";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private subscriptions = new Map<string, SubscriptionRecord>();
  private closedByCaller = false;
  private attempt = 0;

  constructor(private readonly options: RealtimeSocketOptions) {}

  get connectionStatus(): ConnectionStatus {
    return this.status;
  }

  async connect(): Promise<void> {
    this.closedByCaller = false;
    this.setStatus("connecting");

    let ticket: string;
    try {
      const result = await getRealtimeTicket(this.options.accessToken);
      ticket = result.ticket;
    } catch {
      this.scheduleReconnect();
      return;
    }

    const base = this.options.wsUrl ?? process.env.EXPO_PUBLIC_REALTIME_WS_URL ?? DEFAULT_WS_URL;
    const ws = new WebSocket(`${base}?ticket=${encodeURIComponent(ticket)}`);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.attempt = 0;
      this.setStatus("open");
      this.startPing();
      this.resubscribeAll();
    });
    ws.addEventListener("message", (event) =>
      this.handleFrame(String((event as { data: unknown }).data)),
    );
    ws.addEventListener("close", () => {
      this.stopPing();
      this.setStatus("closed");
      if (!this.closedByCaller) this.scheduleReconnect();
    });
    ws.addEventListener("error", () => ws.close());
  }

  subscribe(channel: SubscribeScope, id?: string): void {
    const key = `${channel}:${id ?? ""}`;
    const record: SubscriptionRecord = this.subscriptions.get(key) ?? {
      channel,
      id,
      lastSequence: 0,
    };
    this.subscriptions.set(key, record);
    this.sendSubscribeFrame(record);
  }

  unsubscribe(channel: SubscribeScope, id?: string): void {
    this.subscriptions.delete(`${channel}:${id ?? ""}`);
    this.send({ type: "unsubscribe", channel, id });
  }

  close(): void {
    this.closedByCaller = true;
    this.stopPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.setStatus("closed");
  }

  private sendSubscribeFrame(record: SubscriptionRecord): void {
    const frame: Record<string, unknown> = {
      type: "subscribe",
      channel: record.channel,
      id: record.id,
    };
    if (record.channel === "conversation" && record.lastSequence > 0)
      frame.after_sequence = record.lastSequence;
    this.send(frame);
  }

  private resubscribeAll(): void {
    for (const record of this.subscriptions.values()) this.sendSubscribeFrame(record);
  }

  private handleFrame(raw: string): void {
    const frame = parseServerFrame(raw);
    if (!frame) return;

    if (frame.type === "resync_required") {
      for (const record of this.subscriptions.values()) record.lastSequence = 0;
      this.options.onResyncRequired?.();
      return;
    }
    if (frame.type === "error") return;

    if (frame.channel === "conversation" && frame.id) {
      const record = this.subscriptions.get(`conversation:${frame.id}`);
      if (record) record.lastSequence = Math.max(record.lastSequence, frame.sequence);
    }
    this.options.onEvent(frame);
  }

  private send(frame: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame));
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => this.send({ type: "ping" }), PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private scheduleReconnect(): void {
    const delayMs = Math.min(1000 * 2 ** this.attempt, 30_000);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => void this.connect(), delayMs);
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.options.onStatusChange?.(status);
  }
}
