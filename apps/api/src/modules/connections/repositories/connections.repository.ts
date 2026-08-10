import {
  blocks,
  type Block,
  connectionRequests,
  connections,
  type Connection,
  type ConnectionRequest,
  conversationParticipants,
  conversations,
  inboundIntentFilters,
  messages,
  profiles,
  userIntents,
  type UserIntent,
  users,
} from "@convene/db";
import { Injectable } from "@nestjs/common";
import { and, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { uuidv7 } from "../../../common/utils/uuidv7";
import { PostgresService } from "../../../infra/postgres/postgres.service";

export type RequestDirection = "sent" | "received";
export type RequestSort = "score_desc" | "recent";

export interface CreateConnectionRequestInput {
  senderId: string;
  recipientId: string;
  intentId: string;
  note: string | null;
  matchScore: number | null;
  matchReasons: string[] | null;
  source: string | null;
  isQueued: boolean;
}

// Owns connection_requests/connections/blocks reads+writes for the
// connections module (P14.1). match_suppressions and the atomic accept
// transaction (connections + conversations + messages) are P14.2's
// concern — this repository only implements what P14.1's send/list/
// withdraw endpoints need.
@Injectable()
export class ConnectionsRepository {
  constructor(private readonly postgres: PostgresService) {}

  // BR-CONN-05: the daily quota window is "the user's local day" — needs
  // the sender's own IANA timezone, defaulted to UTC by the caller when
  // the profile hasn't set one.
  async loadTimezone(userId: string): Promise<string | null> {
    const [row] = await this.postgres.db
      .select({ timezone: profiles.timezone })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    return row?.timezone ?? null;
  }

  async findRecipientStatus(userId: string): Promise<string | null> {
    const [row] = await this.postgres.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.status ?? null;
  }

  async findOwnedActiveIntent(userId: string, intentId: string): Promise<UserIntent | null> {
    const [row] = await this.postgres.db
      .select()
      .from(userIntents)
      .where(
        and(
          eq(userIntents.id, intentId),
          eq(userIntents.userId, userId),
          eq(userIntents.status, "active"),
          eq(userIntents.isPaused, false),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async isBlockedEitherWay(userAId: string, userBId: string): Promise<boolean> {
    const rows = await this.postgres.db
      .select({ blockerId: blocks.blockerId })
      .from(blocks)
      .where(
        or(
          and(eq(blocks.blockerId, userAId), eq(blocks.blockedId, userBId)),
          and(eq(blocks.blockerId, userBId), eq(blocks.blockedId, userAId)),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async findPendingRequestBetween(
    senderId: string,
    recipientId: string,
  ): Promise<ConnectionRequest | null> {
    const [row] = await this.postgres.db
      .select()
      .from(connectionRequests)
      .where(
        and(
          eq(connectionRequests.senderId, senderId),
          eq(connectionRequests.recipientId, recipientId),
          eq(connectionRequests.status, "pending"),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findActiveConnectionBetween(userAId: string, userBId: string): Promise<boolean> {
    const [lo, hi] = userAId < userBId ? [userAId, userBId] : [userBId, userAId];
    const rows = await this.postgres.db
      .select({ id: connections.id })
      .from(connections)
      .where(
        and(
          eq(connections.userAId, lo),
          eq(connections.userBId, hi),
          sql`${connections.removedAt} IS NULL`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  // Most recent responded/removed record for this unordered pair, used to
  // derive BR-CONN-12's cooldowns (30d after rejection, 7d after expiry,
  // 24h after cancellation, 7d after removal). Only the single most-recent
  // terminal event on each side matters for the cooldown check.
  async findMostRecentTerminalRequest(
    senderId: string,
    recipientId: string,
  ): Promise<ConnectionRequest | null> {
    const [row] = await this.postgres.db
      .select()
      .from(connectionRequests)
      .where(
        and(
          eq(connectionRequests.senderId, senderId),
          eq(connectionRequests.recipientId, recipientId),
          inArray(connectionRequests.status, ["rejected", "expired", "cancelled"]),
        ),
      )
      .orderBy(desc(connectionRequests.respondedAt))
      .limit(1);
    return row ?? null;
  }

  // BR-CONN-12: "after rejection 30d and only one retry ever" — a second
  // rejection from the same sender to the same recipient permanently
  // forecloses re-request, so the cooldown check needs the total count,
  // not just the most recent event.
  async countRejectedRequests(senderId: string, recipientId: string): Promise<number> {
    const [row] = await this.postgres.db
      .select({ count: sql<number>`count(*)::int` })
      .from(connectionRequests)
      .where(
        and(
          eq(connectionRequests.senderId, senderId),
          eq(connectionRequests.recipientId, recipientId),
          eq(connectionRequests.status, "rejected"),
        ),
      );
    return row?.count ?? 0;
  }

  async findMostRecentRemoval(userAId: string, userBId: string): Promise<Date | null> {
    const [lo, hi] = userAId < userBId ? [userAId, userBId] : [userBId, userAId];
    const [row] = await this.postgres.db
      .select({ removedAt: connections.removedAt })
      .from(connections)
      .where(
        and(
          eq(connections.userAId, lo),
          eq(connections.userBId, hi),
          sql`${connections.removedAt} IS NOT NULL`,
        ),
      )
      .orderBy(desc(connections.removedAt))
      .limit(1);
    return row?.removedAt ?? null;
  }

  async createRequest(input: CreateConnectionRequestInput): Promise<ConnectionRequest> {
    const [created] = await this.postgres.db
      .insert(connectionRequests)
      .values({
        senderId: input.senderId,
        recipientId: input.recipientId,
        intentId: input.intentId,
        note: input.note,
        matchScore: input.matchScore,
        matchReasons: input.matchReasons,
        source: input.source,
        isQueued: input.isQueued,
      })
      .returning();
    if (!created) throw new Error("ConnectionsRepository: request insert returned no row");
    return created;
  }

  async findRequestById(id: string): Promise<ConnectionRequest | null> {
    const [row] = await this.postgres.db
      .select()
      .from(connectionRequests)
      .where(eq(connectionRequests.id, id))
      .limit(1);
    return row ?? null;
  }

  async withdrawRequest(id: string, now: Date): Promise<ConnectionRequest | null> {
    const [updated] = await this.postgres.db
      .update(connectionRequests)
      .set({ status: "cancelled", respondedAt: now })
      .where(and(eq(connectionRequests.id, id), eq(connectionRequests.status, "pending")))
      .returning();
    return updated ?? null;
  }

  // Cursor-paginated by (match_score DESC, id ASC) per idx_req_recipient's
  // own column order for the recipient direction; the sender direction has
  // no equivalent index but reuses the same ordering for a single response
  // shape.
  async listRequests(params: {
    userId: string;
    direction: RequestDirection;
    status: ConnectionRequest["status"] | undefined;
    sort: RequestSort;
    cursor: { score: number; id: string } | null;
    limit: number;
  }): Promise<ConnectionRequest[]> {
    const ownerColumn =
      params.direction === "received"
        ? connectionRequests.recipientId
        : connectionRequests.senderId;
    const conditions = [eq(ownerColumn, params.userId)];
    if (params.status) conditions.push(eq(connectionRequests.status, params.status));

    if (params.sort === "score_desc") {
      if (params.cursor) {
        const { score, id } = params.cursor;
        conditions.push(
          sql`(${connectionRequests.matchScore} < ${score} OR (${connectionRequests.matchScore} = ${score} AND ${connectionRequests.id} > ${id}))`,
        );
      }
      return this.postgres.db
        .select()
        .from(connectionRequests)
        .where(and(...conditions))
        .orderBy(desc(connectionRequests.matchScore), connectionRequests.id)
        .limit(params.limit);
    }

    if (params.cursor) {
      conditions.push(lt(connectionRequests.id, params.cursor.id));
    }
    return this.postgres.db
      .select()
      .from(connectionRequests)
      .where(and(...conditions))
      .orderBy(desc(connectionRequests.createdAt), connectionRequests.id)
      .limit(params.limit);
  }

  // BR-CONN-07: how many of this recipient's requests are currently
  // queued (is_queued = true, still pending) — used both to compute a new
  // arrival's queued_position and to surface queued_count on the list
  // response.
  async countQueuedForRecipient(recipientId: string): Promise<number> {
    const [row] = await this.postgres.db
      .select({ count: sql<number>`count(*)::int` })
      .from(connectionRequests)
      .where(
        and(
          eq(connectionRequests.recipientId, recipientId),
          eq(connectionRequests.isQueued, true),
          eq(connectionRequests.status, "pending"),
        ),
      );
    return row?.count ?? 0;
  }

  // BR-CONN-07: how many non-queued requests this recipient has already
  // received since their local midnight — compared against their
  // effective inbound cap to decide whether a new arrival must queue.
  async countInboundToday(recipientId: string, sinceLocalMidnightUtc: Date): Promise<number> {
    const [row] = await this.postgres.db
      .select({ count: sql<number>`count(*)::int` })
      .from(connectionRequests)
      .where(
        and(
          eq(connectionRequests.recipientId, recipientId),
          eq(connectionRequests.isQueued, false),
          gt(connectionRequests.createdAt, sinceLocalMidnightUtc),
        ),
      );
    return row?.count ?? 0;
  }

  // §10.6.6 list response's nested `intent` object — id/type/detail only,
  // no ownership check (a request's intent_id may belong to either
  // party depending on `direction`, and the caller already knows which).
  async loadIntentSummaries(
    intentIds: readonly string[],
  ): Promise<Map<string, { id: string; type: string; detail: string | null }>> {
    const result = new Map<string, { id: string; type: string; detail: string | null }>();
    if (intentIds.length === 0) return result;
    const rows = await this.postgres.db
      .select({ id: userIntents.id, type: userIntents.type, detail: userIntents.detail })
      .from(userIntents)
      .where(inArray(userIntents.id, intentIds as string[]));
    for (const row of rows) result.set(row.id, row);
    return result;
  }

  // BR-CONN-07's override: `inbound_intent_filters.max_inbound_per_day`
  // (already built in P8.2 for a related but distinct purpose — the
  // inbound intent-filter settings row). NULL means "no explicit
  // override, use the auto-computed senior/high-rep default" per
  // ConnectionQuotaService.
  async loadInboundThrottleDailyCap(userId: string): Promise<number | null> {
    const [row] = await this.postgres.db
      .select({ dailyCap: inboundIntentFilters.maxInboundPerDay })
      .from(inboundIntentFilters)
      .where(eq(inboundIntentFilters.userId, userId))
      .limit(1);
    return row?.dailyCap ?? null;
  }

  // BR-CONN-03: rejection is a single, silent status flip — no
  // conversation, no notification, no other side effect. The `WHERE
  // status='pending'` guard makes a double-reject (or reject-after-
  // expiry-race) a no-op rather than a second write.
  async rejectRequest(id: string, now: Date): Promise<ConnectionRequest | null> {
    const [updated] = await this.postgres.db
      .update(connectionRequests)
      .set({ status: "rejected", respondedAt: now })
      .where(and(eq(connectionRequests.id, id), eq(connectionRequests.status, "pending")))
      .returning();
    return updated ?? null;
  }

  // BR-CONN-08: one transaction — flip the request to accepted, create
  // the connection (sorted pair per chk_pair_order), create the
  // conversation + both participants, and (if the request carried a
  // note) move that note into the conversation as the first message,
  // attributed to the original sender. Any failure anywhere in this
  // method rolls back every write — no partial accept state is
  // reachable (P14.2's own acceptance criterion). The `WHERE
  // status='pending'` guard on the first UPDATE is what makes a
  // concurrent double-accept race safe: only one transaction ever sees a
  // row back from that update, and everything downstream depends on it.
  async acceptRequest(
    requestId: string,
    now: Date,
  ): Promise<{
    connection: Connection;
    conversationId: string;
    firstMessageId: string | null;
  } | null> {
    return this.postgres.db.transaction(async (tx) => {
      const [request] = await tx
        .update(connectionRequests)
        .set({ status: "accepted", respondedAt: now })
        .where(and(eq(connectionRequests.id, requestId), eq(connectionRequests.status, "pending")))
        .returning();
      if (!request) return null;

      const [userAId, userBId] =
        request.senderId < request.recipientId
          ? [request.senderId, request.recipientId]
          : [request.recipientId, request.senderId];

      const [connection] = await tx
        .insert(connections)
        .values({
          userAId,
          userBId,
          requesterId: request.senderId,
          intentId: request.intentId,
          matchScore: request.matchScore,
          connectedAt: now,
        })
        .onConflictDoNothing({
          target: [connections.userAId, connections.userBId],
          where: sql`${connections.removedAt} IS NULL`,
        })
        .returning();
      const resolvedConnection =
        connection ??
        (await tx
          .select()
          .from(connections)
          .where(
            and(
              eq(connections.userAId, userAId),
              eq(connections.userBId, userBId),
              sql`${connections.removedAt} IS NULL`,
            ),
          )
          .limit(1)
          .then((rows) => rows[0]));
      if (!resolvedConnection)
        throw new Error("ConnectionsRepository: acceptRequest could not resolve a connection row");

      const [conversation] = await tx
        .insert(conversations)
        .values({ connectionId: resolvedConnection.id, type: "direct", state: "active" })
        .returning();
      if (!conversation)
        throw new Error("ConnectionsRepository: conversation insert returned no row");

      await tx.insert(conversationParticipants).values([
        { conversationId: conversation.id, userId: request.senderId },
        { conversationId: conversation.id, userId: request.recipientId },
      ]);

      let firstMessageId: string | null = null;
      if (request.note) {
        const [seqRow] = await tx
          .update(conversations)
          .set({ messageSeq: sql`${conversations.messageSeq} + 1`, lastMessageAt: now })
          .where(eq(conversations.id, conversation.id))
          .returning({ messageSeq: conversations.messageSeq });
        if (!seqRow)
          throw new Error(
            "ConnectionsRepository: conversation sequence allocation returned no row",
          );

        const [message] = await tx
          .insert(messages)
          .values({
            conversationId: conversation.id,
            senderId: request.senderId,
            clientMsgId: uuidv7(),
            sequence: seqRow.messageSeq,
            type: "text",
            body: request.note,
            createdAt: now,
          })
          .returning({ id: messages.id });
        firstMessageId = message?.id ?? null;
      }

      return { connection: resolvedConnection, conversationId: conversation.id, firstMessageId };
    });
  }

  // Edge case 1 (§10.6.10): "A and B send requests to each other
  // simultaneously ... auto-accepted into a connection ... both requests
  // marked accepted." Called instead of the normal pending-insert path
  // when sendRequest() finds an existing reverse-direction pending
  // request. One transaction: insert the new (A->B) request already as
  // 'accepted' (it was never actually pending — there's no "Pending"
  // state a client could observe for it), flip the existing (B->A)
  // request to 'accepted', then the same connection/conversation/message
  // creation acceptRequest() does. The PRD doesn't say which side's note
  // becomes the conversation's first message when both carried one — the
  // pre-existing (chronologically first) request's note wins, since it
  // was the one already "pending" for the other party to see.
  async acceptMutualRequests(
    existingRequestId: string,
    newRequest: CreateConnectionRequestInput,
    now: Date,
  ): Promise<{
    connection: Connection;
    conversationId: string;
    firstMessageId: string | null;
    newRequest: ConnectionRequest;
    existingRequest: ConnectionRequest;
  } | null> {
    return this.postgres.db.transaction(async (tx) => {
      const [existingRequest] = await tx
        .update(connectionRequests)
        .set({ status: "accepted", respondedAt: now })
        .where(
          and(
            eq(connectionRequests.id, existingRequestId),
            eq(connectionRequests.status, "pending"),
          ),
        )
        .returning();
      if (!existingRequest) return null;

      const [newRow] = await tx
        .insert(connectionRequests)
        .values({
          senderId: newRequest.senderId,
          recipientId: newRequest.recipientId,
          intentId: newRequest.intentId,
          note: newRequest.note,
          matchScore: newRequest.matchScore,
          matchReasons: newRequest.matchReasons,
          source: newRequest.source,
          isQueued: false,
          status: "accepted",
          respondedAt: now,
        })
        .returning();
      if (!newRow)
        throw new Error(
          "ConnectionsRepository: acceptMutualRequests new-request insert returned no row",
        );

      const [userAId, userBId] =
        newRow.senderId < newRow.recipientId
          ? [newRow.senderId, newRow.recipientId]
          : [newRow.recipientId, newRow.senderId];

      const [connection] = await tx
        .insert(connections)
        .values({
          userAId,
          userBId,
          requesterId: existingRequest.senderId,
          intentId: existingRequest.intentId,
          matchScore: existingRequest.matchScore,
          connectedAt: now,
        })
        .onConflictDoNothing({
          target: [connections.userAId, connections.userBId],
          where: sql`${connections.removedAt} IS NULL`,
        })
        .returning();
      const resolvedConnection =
        connection ??
        (await tx
          .select()
          .from(connections)
          .where(
            and(
              eq(connections.userAId, userAId),
              eq(connections.userBId, userBId),
              sql`${connections.removedAt} IS NULL`,
            ),
          )
          .limit(1)
          .then((rows) => rows[0]));
      if (!resolvedConnection)
        throw new Error(
          "ConnectionsRepository: acceptMutualRequests could not resolve a connection row",
        );

      const [conversation] = await tx
        .insert(conversations)
        .values({ connectionId: resolvedConnection.id, type: "direct", state: "active" })
        .returning();
      if (!conversation)
        throw new Error("ConnectionsRepository: conversation insert returned no row");

      await tx.insert(conversationParticipants).values([
        { conversationId: conversation.id, userId: newRow.senderId },
        { conversationId: conversation.id, userId: newRow.recipientId },
      ]);

      const firstMessageNote = existingRequest.note ?? newRow.note;
      const firstMessageSenderId = existingRequest.note
        ? existingRequest.senderId
        : newRow.note
          ? newRow.senderId
          : null;
      let firstMessageId: string | null = null;
      if (firstMessageNote && firstMessageSenderId) {
        const [seqRow] = await tx
          .update(conversations)
          .set({ messageSeq: sql`${conversations.messageSeq} + 1`, lastMessageAt: now })
          .where(eq(conversations.id, conversation.id))
          .returning({ messageSeq: conversations.messageSeq });
        if (!seqRow)
          throw new Error(
            "ConnectionsRepository: conversation sequence allocation returned no row",
          );

        const [message] = await tx
          .insert(messages)
          .values({
            conversationId: conversation.id,
            senderId: firstMessageSenderId,
            clientMsgId: uuidv7(),
            sequence: seqRow.messageSeq,
            type: "text",
            body: firstMessageNote,
            createdAt: now,
          })
          .returning({ id: messages.id });
        firstMessageId = message?.id ?? null;
      }

      return {
        connection: resolvedConnection,
        conversationId: conversation.id,
        firstMessageId,
        newRequest: newRow,
        existingRequest,
      };
    });
  }

  // BR-CONN-09: freezes (not archives — that's connection *removal*,
  // P15+ territory) any existing conversation between this pair, so a
  // blocked pair's prior conversation stops accepting new messages the
  // instant the block lands. No-op if they were never connected.
  async freezeConversationBetween(userAId: string, userBId: string): Promise<void> {
    const [lo, hi] = userAId < userBId ? [userAId, userBId] : [userBId, userAId];
    const [connection] = await this.postgres.db
      .select({ id: connections.id })
      .from(connections)
      .where(
        and(
          eq(connections.userAId, lo),
          eq(connections.userBId, hi),
          sql`${connections.removedAt} IS NULL`,
        ),
      )
      .limit(1);
    if (!connection) return;
    await this.postgres.db
      .update(conversations)
      .set({ state: "frozen" })
      .where(eq(conversations.connectionId, connection.id));
  }

  async createBlock(blockerId: string, blockedId: string, reason: string | null): Promise<Block> {
    const [created] = await this.postgres.db
      .insert(blocks)
      .values({ blockerId, blockedId, reason })
      .onConflictDoNothing({ target: [blocks.blockerId, blocks.blockedId] })
      .returning();
    if (created) return created;
    const [existing] = await this.postgres.db
      .select()
      .from(blocks)
      .where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)))
      .limit(1);
    if (!existing)
      throw new Error("ConnectionsRepository: createBlock found no row after onConflictDoNothing");
    return existing;
  }

  // BR-CONN-10: unblocking only removes this row — it never touches
  // `connections`/`removed_at`, which is precisely why the relationship
  // returns to "none" instead of being restored.
  async deleteBlock(blockerId: string, blockedId: string): Promise<void> {
    await this.postgres.db
      .delete(blocks)
      .where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)));
  }

  async listBlocks(blockerId: string): Promise<Block[]> {
    return this.postgres.db
      .select()
      .from(blocks)
      .where(eq(blocks.blockerId, blockerId))
      .orderBy(desc(blocks.createdAt));
  }

  // BR-CONN-04: the expiry sweep's own query — every still-pending
  // request whose 14-day window has passed. Silent to both parties (no
  // notification is emitted for the returned ids).
  async expirePendingRequests(now: Date): Promise<ConnectionRequest[]> {
    return this.postgres.db
      .update(connectionRequests)
      .set({ status: "expired", respondedAt: now })
      .where(and(eq(connectionRequests.status, "pending"), lt(connectionRequests.expiresAt, now)))
      .returning();
  }
}
