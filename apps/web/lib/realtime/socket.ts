import type { QueryClient } from "@tanstack/react-query";
import { applyRealtimeEvent, parseServerFrame, type SubscribeScope } from "./handlers";
import { nextBackoffDelayMs } from "./reconnect";

const DEFAULT_WS_URL = "ws://localhost:8081/socket"; // apps/realtime's own dev-default PORT (8081).
const PING_INTERVAL_MS = 25_000; // No exact heartbeat interval is given in the protocol docs available to this phase (§10.7.5's `heartbeat` frame is stale prose — the real gateway only has a bare `{type:"ping"}`); 25s is a documented assumption, comfortably under any reasonable idle timeout.

export type ConnectionStatus = "idle" | "connecting" | "open" | "closed";

interface SubscriptionRecord {
  channel: SubscribeScope;
  id: string | undefined;
  lastSequence: number;
}

export interface RealtimeSocketOptions {
  queryClient: QueryClient;
  getCurrentUserId: () => string | null;
  wsUrl?: string;
  onStatusChange?: (status: ConnectionStatus) => void;
  onResyncRequired?: () => void;
}

function subscriptionKey(channel: SubscribeScope, id: string | undefined): string {
  return `${channel}:${id ?? ""}`;
}

// lib/realtime/socket.ts owns the WebSocket connection lifecycle only —
// applying an incoming event to app state is handlers.ts's job
// (imported, not reimplemented here), and computing a reconnect delay is
// reconnect.ts's (same). This file is deliberately just plumbing:
// connect (via the ticket BFF route), subscribe/unsubscribe bookkeeping,
// heartbeat, and reconnect-with-resubscribe.
export class RealtimeSocket {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = "idle";
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private subscriptions = new Map<string, SubscriptionRecord>();
  private closedByCaller = false;

  constructor(private readonly options: RealtimeSocketOptions) {}

  get connectionStatus(): ConnectionStatus {
    return this.status;
  }

  async connect(): Promise<void> {
    this.closedByCaller = false;
    this.setStatus("connecting");

    let ticket: string;
    try {
      const response = await fetch("/api/realtime/ticket", { method: "POST" });
      if (!response.ok) throw new Error(`ticket request failed: ${response.status}`);
      const body = (await response.json()) as { ticket: string };
      ticket = body.ticket;
    } catch {
      this.scheduleReconnect();
      return;
    }

    const base = this.options.wsUrl ?? process.env.NEXT_PUBLIC_REALTIME_WS_URL ?? DEFAULT_WS_URL;
    const ws = new WebSocket(`${base}?ticket=${encodeURIComponent(ticket)}`);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.attempt = 0;
      this.setStatus("open");
      this.startPing();
      this.resubscribeAll();
    });

    ws.addEventListener("message", (event) => {
      this.handleFrame(String(event.data));
    });

    ws.addEventListener("close", () => {
      this.stopPing();
      this.setStatus("closed");
      if (!this.closedByCaller) this.scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      ws.close();
    });
  }

  // §17.5: reconnect resubscribes per-channel with `after_sequence` so
  // the replay is gap-free — `lastSequence` is tracked per subscription
  // key exactly for this, updated as events for that key arrive.
  subscribe(channel: SubscribeScope, id?: string): void {
    const key = subscriptionKey(channel, id);
    const existing = this.subscriptions.get(key);
    const record: SubscriptionRecord = existing ?? { channel, id, lastSequence: 0 };
    this.subscriptions.set(key, record);
    this.sendSubscribeFrame(record);
  }

  unsubscribe(channel: SubscribeScope, id?: string): void {
    const key = subscriptionKey(channel, id);
    this.subscriptions.delete(key);
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
      // §17.5: outbound queue overflow — the buffered backlog is gone;
      // every tracked sequence is now meaningless, and the caller is
      // responsible for refetching whatever's affected (typically
      // "everything currently on screen") rather than this file guessing.
      for (const record of this.subscriptions.values()) record.lastSequence = 0;
      this.options.onResyncRequired?.();
      return;
    }

    if (frame.type === "error") return;

    // `rt:user:{id}` is auto-subscribed server-side on connect (never an
    // explicit client subscribe() call, per socket.gateway.ts) — there's
    // no subscription record to track a resubscribe sequence for, so
    // only conversation/presence/admin_reports events update one.
    if (frame.channel !== "user") {
      const key = subscriptionKey(frame.channel, frame.id);
      const record = this.subscriptions.get(key);
      if (record && frame.sequence > record.lastSequence) record.lastSequence = frame.sequence;
    }

    applyRealtimeEvent(this.options.queryClient, frame, this.options.getCurrentUserId());
  }

  private send(frame: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame));
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.send({ type: "ping" }), PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private scheduleReconnect(): void {
    if (this.closedByCaller) return;
    const delay = nextBackoffDelayMs(this.attempt);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => void this.connect(), delay);
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.options.onStatusChange?.(status);
  }
}
