import type { WebSocket } from "ws";

export const OUTBOUND_QUEUE_CAP = 200;

export interface OutboundQueueSocket {
  send(data: string, callback?: (error?: Error) => void): void;
}

// PRD §17.5: "Per-socket outbound queue capped at 200 messages; on
// overflow the gateway sends resync_required and drops the queue —
// correctness is preserved by making the client the one that
// reconciles, never by growing the buffer."
//
// The cap is on *unflushed backlog*, not enqueue rate: each queued frame
// only leaves the queue once ws's own send() callback fires (i.e. the
// previous frame actually made it to the OS socket buffer), so a slow or
// stalled client — not just a fast publisher — is what drives the queue
// toward its cap. A healthy connection that drains as fast as it fills
// never comes near 200.
export class OutboundQueue {
  private queue: string[] = [];
  private draining = false;
  private closed = false;

  constructor(
    private readonly socket: OutboundQueueSocket,
    private readonly cap: number = OUTBOUND_QUEUE_CAP,
  ) {}

  enqueue(payload: string): void {
    if (this.closed) return;

    if (this.queue.length >= this.cap) {
      this.queue = [];
      this.socket.send(JSON.stringify({ type: "resync_required" }));
      // Deliberately does not stay "poisoned" — the client is expected to
      // re-fetch its own state and the connection keeps receiving fresh
      // live events from this point forward; refusing all future delivery
      // would just turn one slow moment into a permanently dead socket.
      return;
    }

    this.queue.push(payload);
    this.drain();
  }

  close(): void {
    this.closed = true;
    this.queue = [];
  }

  private drain(): void {
    if (this.draining) return;
    this.draining = true;
    this.pump();
  }

  private pump(): void {
    const next = this.queue.shift();
    if (next === undefined) {
      this.draining = false;
      return;
    }
    this.socket.send(next, () => this.pump());
  }
}

export function createOutboundQueue(socket: WebSocket): OutboundQueue {
  return new OutboundQueue(socket);
}
