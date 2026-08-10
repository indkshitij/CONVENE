import { describe, expect, it, vi } from "vitest";
import { OutboundQueue, type OutboundQueueSocket } from "./outbound-queue";

// A socket whose send() never invokes its callback until the test tells it
// to — this is what lets a fast publisher genuinely outrun delivery in a
// deterministic, non-flaky way (a real "slow client" would look the same:
// bytes accepted by send() but not yet flushed to the OS).
function stalledSocket() {
  const sent: string[] = [];
  const pendingCallbacks: Array<() => void> = [];
  const socket: OutboundQueueSocket = {
    send: vi.fn((data: string, callback?: (error?: Error) => void) => {
      sent.push(data);
      if (callback) pendingCallbacks.push(callback);
    }),
  };
  return {
    socket,
    sent,
    flushOne(): void {
      pendingCallbacks.shift()?.();
    },
  };
}

describe("OutboundQueue", () => {
  it("delivers messages in order on a healthy (immediately-flushing) socket", () => {
    const sent: string[] = [];
    const socket: OutboundQueueSocket = {
      send: (data, callback) => {
        sent.push(data);
        callback?.();
      },
    };
    const queue = new OutboundQueue(socket, 200);

    queue.enqueue("a");
    queue.enqueue("b");
    queue.enqueue("c");

    expect(sent).toEqual(["a", "b", "c"]);
  });

  it("sends resync_required and drops the backlog once unflushed messages exceed the cap", () => {
    const { socket, sent, flushOne } = stalledSocket();
    const queue = new OutboundQueue(socket, 5);

    // The first enqueue() is immediately handed to send() (nothing queued
    // yet to drain), so it never touches the queue array — only the next
    // `cap` (5) enqueues sit in queue[] waiting on that first send's
    // callback, and the (cap + 2)th is what overflows.
    for (let i = 0; i < 7; i++) {
      queue.enqueue(`msg-${i}`);
    }

    const resync = sent[sent.length - 1]!;
    expect(JSON.parse(resync)).toEqual({ type: "resync_required" });
    void flushOne; // unused in this assertion path, kept for symmetry with the recovery test below
  });

  it("resumes normal delivery after an overflow — the client is expected to resync, not the socket to stay dead", () => {
    const { socket, sent, flushOne } = stalledSocket();
    const queue = new OutboundQueue(socket, 3);

    for (let i = 0; i < 5; i++) queue.enqueue(`flood-${i}`);
    expect(JSON.parse(sent[sent.length - 1]!)).toEqual({ type: "resync_required" });

    queue.enqueue("after-resync");

    // Draining resumes exactly the way it always does — once the
    // in-flight send's callback fires, the pump moves on to whatever's
    // next in the (now-fresh, post-overflow) queue.
    flushOne(); // completes the original flood-0 send, pump advances to the post-overflow backlog
    flushOne(); // completes whatever was queued right after the overflow

    expect(sent[sent.length - 1]).toBe("after-resync");
  });

  it("close() stops delivering anything further", () => {
    const sent: string[] = [];
    const socket: OutboundQueueSocket = {
      send: (data, callback) => {
        sent.push(data);
        callback?.();
      },
    };
    const queue = new OutboundQueue(socket, 200);
    queue.close();
    queue.enqueue("should-not-appear");

    expect(sent).toEqual([]);
  });
});
