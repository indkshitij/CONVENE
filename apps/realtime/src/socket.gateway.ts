import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import { hostname } from "node:os";
import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { ChannelFanoutService } from "./channel-fanout.service";
import {
  ADMIN_REPORTS_CHANNEL,
  conversationChannel,
  presenceGeoChannel,
  userChannel,
} from "./infra/redis/channels";
import { OutboundQueue } from "./outbound-queue";
import { PresenceService } from "./presence.service";
import { type ReplayEntry, ReplayService } from "./replay.service";
import { InvalidTicketError, TicketService } from "./ticket.service";

const SOCKET_PATH = "/socket";
// App-level close codes (RFC 6455 reserves 4000-4999 for private use).
const CLOSE_TICKET_REQUIRED = 4401;
const CLOSE_INVALID_TICKET = 4402;

const ADMIN_ROLES = new Set(["moderator", "admin"]);

type SubscribeScope = "conversation" | "presence" | "admin_reports";

interface ConnectionMeta {
  userId: string;
  connId: string;
  role: string;
  outboundQueue: OutboundQueue;
}

interface ClientMessage {
  type?: unknown;
  channel?: unknown;
  id?: unknown;
  after_sequence?: unknown;
}

// PRD §17.5: "Connection establishment ... opens wss://.../socket?ticket=…"
// and "the gateway holds no authoritative state" — this class owns no
// per-connection state beyond an in-process map used to route incoming
// frames; everything that must survive this process dying (who's
// connected, presence, recent channel history) lives in Redis via
// PresenceService/ChannelFanoutService/ReplayService.
//
// P11.2 protocol (client -> gateway JSON frames), on top of P11.1's ping:
//   {type:"subscribe", channel:"conversation", id, after_sequence?}
//   {type:"subscribe", channel:"presence", id}       // id = geohash5
//   {type:"subscribe", channel:"admin_reports"}       // role-gated
//   {type:"unsubscribe", channel, id?}
// Gateway -> client:
//   {type:"event", channel, id, sequence, event, payload}
//   {type:"resync_required"}                          // backpressure overflow (outbound-queue.ts)
//   {type:"error", message}
//
// rt:user:{id} is always auto-subscribed at connect (never client-
// toggleable — it's always exactly the ticket-holder's own channel).
@Injectable()
export class SocketGateway implements OnModuleDestroy {
  private readonly logger = new Logger(SocketGateway.name);
  private readonly node = process.env.HOSTNAME ?? hostname();
  private wss: WebSocketServer | undefined;

  constructor(
    private readonly ticketService: TicketService,
    private readonly presenceService: PresenceService,
    private readonly fanout: ChannelFanoutService,
    private readonly replayService: ReplayService,
  ) {}

  attach(httpServer: HttpServer): void {
    this.wss = new WebSocketServer({ server: httpServer, path: SOCKET_PATH });
    this.wss.on("connection", (socket: WebSocket, request: IncomingMessage) => {
      void this.handleConnection(socket, request);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.wss?.close();
  }

  private async handleConnection(socket: WebSocket, request: IncomingMessage): Promise<void> {
    const ticket = new URL(request.url ?? "", "http://internal").searchParams.get("ticket");
    if (!ticket) {
      socket.close(CLOSE_TICKET_REQUIRED, "ticket_required");
      return;
    }

    let userId: string;
    let role: string;
    try {
      ({ userId, role } = await this.ticketService.verifyTicket(ticket));
    } catch (error) {
      if (!(error instanceof InvalidTicketError)) {
        this.logger.error("Unexpected error verifying WS ticket", error);
      }
      socket.close(CLOSE_INVALID_TICKET, "invalid_ticket");
      return;
    }

    const connId = randomUUID();
    const meta: ConnectionMeta = { userId, connId, role, outboundQueue: new OutboundQueue(socket) };
    await this.presenceService.registerConnection(userId, connId, this.node);

    // Own-user channel: always on, never requested, never unsubscribed.
    await this.fanout.subscribe(userChannel(userId), connId, (raw) => {
      meta.outboundQueue.enqueue(this.envelope("user", userId, raw));
    });

    socket.on("message", (data) => this.handleMessage(meta, data));
    socket.on("close", () => void this.handleClose(meta));
  }

  private handleMessage(meta: ConnectionMeta, data: RawData): void {
    let payload: ClientMessage;
    try {
      payload = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      return; // malformed frame — silently dropped, same as P11.1
    }
    if (!payload || typeof payload !== "object") return;

    if (payload.type === "ping") {
      this.presenceService.heartbeat(meta.userId, meta.connId).catch((error: unknown) => {
        this.logger.error(`Failed to record heartbeat for ${meta.userId}/${meta.connId}`, error);
      });
      return;
    }

    if (payload.type === "subscribe") {
      void this.handleSubscribe(meta, payload).catch((error: unknown) => {
        this.logger.error(`Failed to handle subscribe for ${meta.userId}/${meta.connId}`, error);
      });
      return;
    }

    if (payload.type === "unsubscribe") {
      void this.handleUnsubscribe(meta, payload).catch((error: unknown) => {
        this.logger.error(`Failed to handle unsubscribe for ${meta.userId}/${meta.connId}`, error);
      });
    }
  }

  private async handleSubscribe(meta: ConnectionMeta, message: ClientMessage): Promise<void> {
    const scope = message.channel;
    if (scope !== "conversation" && scope !== "presence" && scope !== "admin_reports") return;

    if (scope === "admin_reports") {
      if (!ADMIN_ROLES.has(meta.role)) {
        meta.outboundQueue.enqueue(JSON.stringify({ type: "error", message: "forbidden" }));
        return;
      }
      await this.fanout.subscribe(ADMIN_REPORTS_CHANNEL, meta.connId, (raw) => {
        meta.outboundQueue.enqueue(this.envelope("admin_reports", undefined, raw));
      });
      return;
    }

    const id = typeof message.id === "string" ? message.id : undefined;
    if (!id) return;

    if (scope === "presence") {
      await this.fanout.subscribe(presenceGeoChannel(id), meta.connId, (raw) => {
        meta.outboundQueue.enqueue(this.envelope("presence", id, raw));
      });
      return;
    }

    // scope === "conversation" — PRD §17.5: "on reconnect the client sends
    // {conversationId, after_sequence} per open conversation and receives
    // a gap-free replay." Subscribe-then-backfill, race-free: live
    // messages that arrive while the backlog fetch is in flight are
    // buffered, not dropped or double-delivered, then flushed in sequence
    // order once the backlog itself has been sent.
    const afterSequence =
      typeof message.after_sequence === "number" ? message.after_sequence : undefined;
    await this.subscribeConversation(meta, id, afterSequence);
  }

  private async subscribeConversation(
    meta: ConnectionMeta,
    conversationId: string,
    afterSequence: number | undefined,
  ): Promise<void> {
    const channel = conversationChannel(conversationId);
    let lastSent = afterSequence ?? -1;
    let backfilling = afterSequence !== undefined;
    const pendingLive: ReplayEntry[] = [];

    const deliver = (entry: ReplayEntry): void => {
      if (entry.sequence <= lastSent) return; // already delivered via backlog — dedupe.
      lastSent = entry.sequence;
      meta.outboundQueue.enqueue(
        this.envelope("conversation", conversationId, JSON.stringify(entry)),
      );
    };

    await this.fanout.subscribe(channel, meta.connId, (raw) => {
      const entry = JSON.parse(raw) as ReplayEntry;
      if (backfilling) {
        pendingLive.push(entry);
        return;
      }
      deliver(entry);
    });

    if (afterSequence === undefined) return;

    const backlog = await this.replayService.getSince(channel, afterSequence);
    for (const entry of backlog) deliver(entry);
    backfilling = false;
    for (const entry of pendingLive) deliver(entry);
  }

  private async handleUnsubscribe(meta: ConnectionMeta, message: ClientMessage): Promise<void> {
    const scope = message.channel;
    if (scope === "admin_reports") {
      await this.fanout.unsubscribe(ADMIN_REPORTS_CHANNEL, meta.connId);
      return;
    }
    const id = typeof message.id === "string" ? message.id : undefined;
    if (!id) return;
    if (scope === "conversation")
      await this.fanout.unsubscribe(conversationChannel(id), meta.connId);
    if (scope === "presence") await this.fanout.unsubscribe(presenceGeoChannel(id), meta.connId);
  }

  private envelope(scope: "user" | SubscribeScope, id: string | undefined, raw: string): string {
    const entry = JSON.parse(raw) as ReplayEntry;
    return JSON.stringify({ type: "event", channel: scope, id, ...entry });
  }

  private async handleClose(meta: ConnectionMeta): Promise<void> {
    meta.outboundQueue.close();
    await this.fanout.unsubscribeAll(meta.connId);
    await this.presenceService.removeConnection(meta.userId, meta.connId);
  }
}
