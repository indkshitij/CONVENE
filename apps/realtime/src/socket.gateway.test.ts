import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { ChannelFanoutService } from "./channel-fanout.service";
import type { PresenceService } from "./presence.service";
import type { ReplayEntry, ReplayService } from "./replay.service";
import { SocketGateway } from "./socket.gateway";
import { InvalidTicketError, type TicketService } from "./ticket.service";

function fakePresence() {
  return {
    registerConnection: vi.fn(async () => undefined),
    heartbeat: vi.fn(async () => undefined),
    removeConnection: vi.fn(async () => undefined),
  } as unknown as PresenceService;
}

function fakeTicketService(resolveUserId: Record<string, { userId: string; role: string }>) {
  return {
    verifyTicket: vi.fn(async (ticket: string) => {
      const resolved = resolveUserId[ticket];
      if (!resolved) throw new InvalidTicketError("invalid or already used");
      delete resolveUserId[ticket]; // single-use, mirrors the real service
      return resolved;
    }),
  } as unknown as TicketService;
}

// A real (in-process) fan-out: subscribe/unsubscribe track handlers per
// channel exactly like the Redis-backed one, and publish() lets a test
// simulate an inbound Redis pub/sub message without needing real Redis.
function fakeFanout() {
  const handlers = new Map<string, Map<string, (raw: string) => void>>();
  return {
    subscribe: vi.fn(async (channel: string, id: string, onMessage: (raw: string) => void) => {
      let byId = handlers.get(channel);
      if (!byId) {
        byId = new Map();
        handlers.set(channel, byId);
      }
      byId.set(id, onMessage);
    }),
    unsubscribe: vi.fn(async (channel: string, id: string) => {
      handlers.get(channel)?.delete(id);
    }),
    unsubscribeAll: vi.fn(async (id: string) => {
      for (const byId of handlers.values()) byId.delete(id);
    }),
    publish(channel: string, entry: ReplayEntry) {
      handlers.get(channel)?.forEach((handler) => handler(JSON.stringify(entry)));
    },
  } as unknown as ChannelFanoutService & { publish(channel: string, entry: ReplayEntry): void };
}

function fakeReplay(buffers: Record<string, ReplayEntry[]> = {}) {
  return {
    getSince: vi.fn(async (channel: string, after: number) =>
      (buffers[channel] ?? []).filter((entry) => entry.sequence > after),
    ),
  } as unknown as ReplayService;
}

async function startGateway(gateway: SocketGateway): Promise<{ server: Server; url: string }> {
  const server = createServer((_req, res) => res.end());
  gateway.attach(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `ws://127.0.0.1:${port}/socket` };
}

function waitForClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.on("open", () => resolve());
    socket.on("error", reject);
  });
}

function collectMessages(socket: WebSocket): unknown[] {
  const received: unknown[] = [];
  socket.on("message", (data) => received.push(JSON.parse(data.toString())));
  return received;
}

describe("SocketGateway", () => {
  let servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    servers = [];
  });

  it("closes the connection with 4401 when no ticket is supplied", async () => {
    const gateway = new SocketGateway(
      fakeTicketService({}),
      fakePresence(),
      fakeFanout(),
      fakeReplay(),
    );
    const { server, url } = await startGateway(gateway);
    servers.push(server);

    const socket = new WebSocket(url);
    const closed = await waitForClose(socket);
    expect(closed.code).toBe(4401);
  });

  it("closes the connection with 4402 when the ticket fails verification", async () => {
    const gateway = new SocketGateway(
      fakeTicketService({}),
      fakePresence(),
      fakeFanout(),
      fakeReplay(),
    );
    const { server, url } = await startGateway(gateway);
    servers.push(server);

    const socket = new WebSocket(`${url}?ticket=bogus`);
    const closed = await waitForClose(socket);
    expect(closed.code).toBe(4402);
  });

  it("accepts a valid ticket, registers presence, and auto-subscribes rt:user:{id}", async () => {
    const presence = fakePresence();
    const fanout = fakeFanout();
    const gateway = new SocketGateway(
      fakeTicketService({ "good-ticket": { userId: "user-1", role: "user" } }),
      presence,
      fanout,
      fakeReplay(),
    );
    const { server, url } = await startGateway(gateway);
    servers.push(server);

    const socket = new WebSocket(`${url}?ticket=good-ticket`);
    await waitForOpen(socket);
    await vi.waitFor(() => expect(presence.registerConnection).toHaveBeenCalledTimes(1));
    expect(presence.registerConnection).toHaveBeenCalledWith(
      "user-1",
      expect.any(String),
      expect.any(String),
    );
    expect(fanout.subscribe).toHaveBeenCalledWith(
      "rt:user:user-1",
      expect.any(String),
      expect.any(Function),
    );
    socket.close();
  });

  it("a client ping triggers a presence heartbeat", async () => {
    const presence = fakePresence();
    const gateway = new SocketGateway(
      fakeTicketService({ "good-ticket": { userId: "user-1", role: "user" } }),
      presence,
      fakeFanout(),
      fakeReplay(),
    );
    const { server, url } = await startGateway(gateway);
    servers.push(server);

    const socket = new WebSocket(`${url}?ticket=good-ticket`);
    await waitForOpen(socket);
    await vi.waitFor(() => expect(presence.registerConnection).toHaveBeenCalledTimes(1));

    socket.send(JSON.stringify({ type: "ping" }));
    await vi.waitFor(() => expect(presence.heartbeat).toHaveBeenCalledTimes(1));
    socket.close();
  });

  it("disconnecting removes the connection from presence and unsubscribes every channel", async () => {
    const presence = fakePresence();
    const fanout = fakeFanout();
    const gateway = new SocketGateway(
      fakeTicketService({ "good-ticket": { userId: "user-1", role: "user" } }),
      presence,
      fanout,
      fakeReplay(),
    );
    const { server, url } = await startGateway(gateway);
    servers.push(server);

    const socket = new WebSocket(`${url}?ticket=good-ticket`);
    await waitForOpen(socket);
    await vi.waitFor(() => expect(presence.registerConnection).toHaveBeenCalledTimes(1));

    socket.close();
    await vi.waitFor(() => expect(presence.removeConnection).toHaveBeenCalledTimes(1));
    expect(presence.removeConnection).toHaveBeenCalledWith("user-1", expect.any(String));
    expect(fanout.unsubscribeAll).toHaveBeenCalledWith(expect.any(String));
  });

  it("delivers a presence-channel broadcast to a client subscribed to that geohash5", async () => {
    const fanout = fakeFanout();
    const gateway = new SocketGateway(
      fakeTicketService({ "good-ticket": { userId: "user-1", role: "user" } }),
      fakePresence(),
      fanout,
      fakeReplay(),
    );
    const { server, url } = await startGateway(gateway);
    servers.push(server);

    const socket = new WebSocket(`${url}?ticket=good-ticket`);
    const received = collectMessages(socket);
    await waitForOpen(socket);

    socket.send(JSON.stringify({ type: "subscribe", channel: "presence", id: "u4pruy" }));
    await vi.waitFor(() =>
      expect(fanout.subscribe).toHaveBeenCalledWith(
        "rt:presence:u4pruy",
        expect.any(String),
        expect.any(Function),
      ),
    );

    fanout.publish("rt:presence:u4pruy", {
      sequence: 1,
      event: "availability.started",
      payload: { userId: "user-9", state: "available_now" },
    });

    await vi.waitFor(() => expect(received.length).toBeGreaterThan(0));
    expect(received[0]).toEqual({
      type: "event",
      channel: "presence",
      id: "u4pruy",
      sequence: 1,
      event: "availability.started",
      payload: { userId: "user-9", state: "available_now" },
    });
    socket.close();
  });

  it("rejects an admin_reports subscribe from a non-moderator role", async () => {
    const fanout = fakeFanout();
    const gateway = new SocketGateway(
      fakeTicketService({ "good-ticket": { userId: "user-1", role: "user" } }),
      fakePresence(),
      fanout,
      fakeReplay(),
    );
    const { server, url } = await startGateway(gateway);
    servers.push(server);

    const socket = new WebSocket(`${url}?ticket=good-ticket`);
    const received = collectMessages(socket);
    await waitForOpen(socket);

    socket.send(JSON.stringify({ type: "subscribe", channel: "admin_reports" }));
    await vi.waitFor(() => expect(received.length).toBeGreaterThan(0));

    expect(received[0]).toEqual({ type: "error", message: "forbidden" });
    expect(fanout.subscribe).not.toHaveBeenCalledWith(
      "rt:admin:reports",
      expect.anything(),
      expect.anything(),
    );
    socket.close();
  });

  it("allows a moderator to subscribe to rt:admin:reports", async () => {
    const fanout = fakeFanout();
    const gateway = new SocketGateway(
      fakeTicketService({ "mod-ticket": { userId: "mod-1", role: "moderator" } }),
      fakePresence(),
      fanout,
      fakeReplay(),
    );
    const { server, url } = await startGateway(gateway);
    servers.push(server);

    const socket = new WebSocket(`${url}?ticket=mod-ticket`);
    await waitForOpen(socket);

    socket.send(JSON.stringify({ type: "subscribe", channel: "admin_reports" }));
    await vi.waitFor(() =>
      expect(fanout.subscribe).toHaveBeenCalledWith(
        "rt:admin:reports",
        expect.any(String),
        expect.any(Function),
      ),
    );
    socket.close();
  });

  // PRD §17.5: "on reconnect the client sends {conversationId,
  // after_sequence} per open conversation and receives a gap-free
  // replay." The replay backlog fetch is deliberately made to resolve
  // *after* a live message has already arrived on the same channel, to
  // prove the subscribe-then-backfill race is handled: the live message
  // must not be dropped, and must not be delivered before (or duplicated
  // with) the backlog entries that precede it in sequence.
  it("reconnecting with after_sequence replays gap-free, including a message that raced the backfill fetch", async () => {
    const fanout = fakeFanout();
    const backlog: ReplayEntry[] = [
      { sequence: 1, event: "message.new", payload: { text: "one" } },
      { sequence: 2, event: "message.new", payload: { text: "two" } },
    ];
    const replay = fakeReplay();
    (replay.getSince as ReturnType<typeof vi.fn>).mockImplementation(
      async (channel: string, after: number) => {
        // A live message ("three") arrives on the channel while the backlog
        // fetch is still in flight — subscribeConversation must buffer it,
        // not drop it or race it ahead of the backlog.
        fanout.publish(channel, { sequence: 3, event: "message.new", payload: { text: "three" } });
        return backlog.filter((entry) => entry.sequence > after);
      },
    );

    const gateway = new SocketGateway(
      fakeTicketService({ "good-ticket": { userId: "user-1", role: "user" } }),
      fakePresence(),
      fanout,
      replay,
    );
    const { server, url } = await startGateway(gateway);
    servers.push(server);

    const socket = new WebSocket(`${url}?ticket=good-ticket`);
    const received = collectMessages(socket);
    await waitForOpen(socket);

    socket.send(
      JSON.stringify({
        type: "subscribe",
        channel: "conversation",
        id: "conv-1",
        after_sequence: 0,
      }),
    );

    await vi.waitFor(() => expect(received.length).toBe(3));
    expect(received.map((message) => (message as { sequence: number }).sequence)).toEqual([
      1, 2, 3,
    ]);
    expect(
      received.map((message) => (message as { payload: { text: string } }).payload.text),
    ).toEqual(["one", "two", "three"]);
    socket.close();
  });

  it("unsubscribing from a conversation stops further delivery", async () => {
    const fanout = fakeFanout();
    const gateway = new SocketGateway(
      fakeTicketService({ "good-ticket": { userId: "user-1", role: "user" } }),
      fakePresence(),
      fanout,
      fakeReplay(),
    );
    const { server, url } = await startGateway(gateway);
    servers.push(server);

    const socket = new WebSocket(`${url}?ticket=good-ticket`);
    const received = collectMessages(socket);
    await waitForOpen(socket);

    socket.send(JSON.stringify({ type: "subscribe", channel: "conversation", id: "conv-1" }));
    await vi.waitFor(() =>
      expect(fanout.subscribe).toHaveBeenCalledWith(
        "rt:conv:conv-1",
        expect.any(String),
        expect.any(Function),
      ),
    );

    socket.send(JSON.stringify({ type: "unsubscribe", channel: "conversation", id: "conv-1" }));
    await vi.waitFor(() =>
      expect(fanout.unsubscribe).toHaveBeenCalledWith("rt:conv:conv-1", expect.any(String)),
    );

    fanout.publish("rt:conv:conv-1", {
      sequence: 1,
      event: "message.new",
      payload: { text: "should not arrive" },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toHaveLength(0);
    socket.close();
  });

  // PRD §17.5: "any gateway node can serve any user; killing a node costs
  // clients one reconnect." Two independent SocketGateway instances
  // (representing two replicas) share the same TicketService/
  // PresenceService — both would be Redis-backed in production, which is
  // exactly what makes this work: neither gateway instance holds anything
  // the other needs. A ticket is single-use, so a real reconnect always
  // presents a *new* ticket (the client re-calls POST /realtime/ticket) —
  // modelled here as a second entry in the shared ticket map.
  it("killing one replica costs the client exactly one reconnect, served by a different replica", async () => {
    const presenceA = fakePresence();
    const presenceB = fakePresence();
    const tickets = { "ticket-1": { userId: "user-1", role: "user" } };
    const ticketService = fakeTicketService(tickets);

    const gatewayA = new SocketGateway(ticketService, presenceA, fakeFanout(), fakeReplay());
    const { server: serverA, url: urlA } = await startGateway(gatewayA);
    servers.push(serverA);

    const socketA = new WebSocket(`${urlA}?ticket=ticket-1`);
    await waitForOpen(socketA);
    await vi.waitFor(() => expect(presenceA.registerConnection).toHaveBeenCalledTimes(1));

    // Replica A dies.
    socketA.terminate();
    await gatewayA.onModuleDestroy();
    serverA.close();

    // Client reconnects — exactly once — through replica B with a fresh ticket.
    (tickets as Record<string, { userId: string; role: string }>)["ticket-2"] = {
      userId: "user-1",
      role: "user",
    };
    const gatewayB = new SocketGateway(ticketService, presenceB, fakeFanout(), fakeReplay());
    const { server: serverB, url: urlB } = await startGateway(gatewayB);
    servers.push(serverB);

    const socketB = new WebSocket(`${urlB}?ticket=ticket-2`);
    await waitForOpen(socketB);
    await vi.waitFor(() => expect(presenceB.registerConnection).toHaveBeenCalledTimes(1));

    expect(presenceB.registerConnection).toHaveBeenCalledWith(
      "user-1",
      expect.any(String),
      expect.any(String),
    );
    socketB.close();
  });
});
