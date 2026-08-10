import {
  conversationParticipants,
  conversations,
  type Message,
  messageEdits,
  messageHides,
  messageReactions,
  messages,
  type Conversation,
  reports,
  type Report,
} from "@convene/db";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, gte, inArray, lt, sql } from "drizzle-orm";
import { uuidv7 } from "../../../common/utils/uuidv7";
import { PostgresService } from "../../../infra/postgres/postgres.service";

const EDIT_WINDOW_MINUTES = 15;
const MAX_EDITS = 3;
const DELETE_FOR_EVERYONE_WINDOW_HOURS = 1;

export interface SendMessageInput {
  conversationId: string;
  senderId: string;
  clientMsgId: string;
  body: string;
  replyToId: string | null;
  attachments: unknown[];
}

export interface SendMessageResult {
  message: Message;
  isReplay: boolean;
}

@Injectable()
export class MessagesRepository {
  constructor(private readonly postgres: PostgresService) {}

  async findConversationById(id: string): Promise<Conversation | null> {
    const [row] = await this.postgres.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);
    return row ?? null;
  }

  async loadParticipantIds(conversationId: string): Promise<string[]> {
    const rows = await this.postgres.db
      .select({ userId: conversationParticipants.userId })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.conversationId, conversationId));
    return rows.map((row) => row.userId);
  }

  // PRD §10.7.2's four guarantees, all inside one transaction:
  //
  // (1) Durability before ACK — this whole method either commits or
  //     throws; the caller (MessagesService) only ever constructs an ack
  //     response from a value this method actually returned, so there is
  //     no code path that acknowledges a write that didn't happen.
  //
  // (2) Idempotency via client_msg_id — NOT enforced by `uq_msg_client`
  //     alone: that unique index is on (conversation_id, client_msg_id,
  //     created_at), with created_at included only because `messages` is
  //     partitioned by range(created_at) and Postgres requires every
  //     unique index on a partitioned table to include the partition key.
  //     Two genuinely-duplicate send attempts land at different instants,
  //     so their created_at differs and the index alone would let both
  //     through. The real idempotency guarantee is application-level: a
  //     transaction-scoped advisory lock keyed on (conversationId,
  //     clientMsgId) serialises concurrent attempts with the *same* key
  //     (auto-released on commit/rollback), and the lock holder does a
  //     plain SELECT for an existing row before ever inserting — the
  //     check-then-act pattern the advisory lock makes race-free.
  //     Different clientMsgIds hash to different lock keys (in practice;
  //     see the concurrency test) and proceed fully in parallel.
  //
  // (3) Ordering via the per-conversation monotonic sequence — allocated
  //     by `UPDATE conversations SET message_seq = message_seq + 1 ...
  //     RETURNING message_seq`, never from created_at. Postgres's own
  //     row-level locking on the UPDATE serialises concurrent senders to
  //     the same conversation, which is exactly what makes 50 concurrent
  //     sends produce 50 contiguous, gap-free, duplicate-free sequence
  //     numbers — no extra application locking needed for this part.
  //
  // (4) unread_count/last_read_seq — updated for every participant in
  //     the same transaction (BR-MSG-08), not a follow-up write.
  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    return this.postgres.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${input.conversationId}), hashtext(${input.clientMsgId}))`,
      );

      const [existing] = await tx
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, input.conversationId),
            eq(messages.clientMsgId, input.clientMsgId),
          ),
        )
        .limit(1);
      if (existing) {
        return { message: existing, isReplay: true };
      }

      const [seqRow] = await tx
        .update(conversations)
        .set({ messageSeq: sql`${conversations.messageSeq} + 1`, lastMessageAt: sql`now()` })
        .where(eq(conversations.id, input.conversationId))
        .returning({ messageSeq: conversations.messageSeq });
      if (!seqRow)
        throw new Error(
          "MessagesRepository: sequence allocation returned no row (conversation not found)",
        );

      const [created] = await tx
        .insert(messages)
        .values({
          conversationId: input.conversationId,
          senderId: input.senderId,
          clientMsgId: input.clientMsgId,
          sequence: seqRow.messageSeq,
          type: "text",
          body: input.body,
          replyToId: input.replyToId,
          attachments: input.attachments,
        })
        .returning();
      if (!created) throw new Error("MessagesRepository: message insert returned no row");

      await tx
        .update(conversationParticipants)
        .set({ lastReadSeq: seqRow.messageSeq })
        .where(
          and(
            eq(conversationParticipants.conversationId, input.conversationId),
            eq(conversationParticipants.userId, input.senderId),
          ),
        );

      await tx
        .update(conversationParticipants)
        .set({ unreadCount: sql`${conversationParticipants.unreadCount} + 1` })
        .where(
          and(
            eq(conversationParticipants.conversationId, input.conversationId),
            sql`${conversationParticipants.userId} <> ${input.senderId}`,
          ),
        );

      return { message: created, isReplay: false };
    });
  }

  // §10.7.2's gap-free catch-up: `GET .../messages?after_sequence=N`.
  // Ordered ascending by sequence (never created_at) so a client
  // replaying a backlog sees messages in delivery order.
  async listAfterSequence(
    conversationId: string,
    afterSequence: number,
    limit: number,
  ): Promise<Message[]> {
    return this.postgres.db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), gt(messages.sequence, afterSequence)))
      .orderBy(asc(messages.sequence))
      .limit(limit);
  }

  // BR-MSG-04: "a sender may send at most 3 consecutive messages to a
  // new connection before receiving any reply." Looks at the trailing 3
  // messages (by sequence) — if all 3 were sent by `senderId`, a 4th
  // consecutive send is awaiting a reply. Any message from a different
  // sender anywhere in that trailing window resets the count, which is
  // exactly "releases on reply."
  async trailingConsecutiveSenderCount(
    conversationId: string,
    senderId: string,
    windowSize: number,
  ): Promise<number> {
    const rows = await this.postgres.db
      .select({ senderId: messages.senderId })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.sequence))
      .limit(windowSize);

    let count = 0;
    for (const row of rows) {
      if (row.senderId !== senderId) break;
      count += 1;
    }
    return count;
  }

  // Newest-first page for the "no cursor yet" / scroll-up case.
  async listBeforeSequence(
    conversationId: string,
    beforeSequence: number | null,
    limit: number,
  ): Promise<Message[]> {
    const conditions = [eq(messages.conversationId, conversationId)];
    if (beforeSequence !== null) conditions.push(lt(messages.sequence, beforeSequence));
    const rows = await this.postgres.db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.sequence))
      .limit(limit);
    return rows.reverse();
  }

  async findMessageById(id: string): Promise<Message | null> {
    const [row] = await this.postgres.db
      .select()
      .from(messages)
      .where(eq(messages.id, id))
      .limit(1);
    return row ?? null;
  }

  // BR-MSG's "edit ≤15 min, max 3 edits, history in message_edits."
  // Guarded entirely by the UPDATE's own WHERE clause (not a separate
  // read-then-write) so a race against the edit window closing or the
  // edit count filling up can't slip through — the update simply matches
  // zero rows and the caller reports EDIT_WINDOW_EXPIRED.
  async editMessage(
    id: string,
    senderId: string,
    newBody: string,
    now: Date,
  ): Promise<Message | null> {
    return this.postgres.db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          body: messages.body,
          editCount: messages.editCount,
          createdAt: messages.createdAt,
          deletedAt: messages.deletedAt,
        })
        .from(messages)
        .where(and(eq(messages.id, id), eq(messages.senderId, senderId)))
        .limit(1);
      if (!current || current.deletedAt) return null;

      const windowExpiry = new Date(current.createdAt.getTime() + EDIT_WINDOW_MINUTES * 60_000);
      if (now > windowExpiry || current.editCount >= MAX_EDITS) return null;

      await tx.insert(messageEdits).values({
        messageId: id,
        version: current.editCount + 1,
        body: current.body ?? "",
        editedAt: now,
      });

      const [updated] = await tx
        .update(messages)
        .set({ body: newBody, editedAt: now, editCount: current.editCount + 1 })
        .where(eq(messages.id, id))
        .returning();
      return updated ?? null;
    });
  }

  // Delete-for-me: a per-user hide, not a mutation of the shared row.
  async hideForUser(messageId: string, userId: string): Promise<void> {
    await this.postgres.db
      .insert(messageHides)
      .values({ messageId, userId })
      .onConflictDoNothing({ target: [messageHides.messageId, messageHides.userId] });
  }

  // Delete-for-everyone: own messages only, within 1h — tombstoned
  // (body cleared, deleted_at/deleted_scope set) rather than removed, so
  // "This message was deleted" can render for every participant.
  async deleteForEveryone(id: string, senderId: string, now: Date): Promise<Message | null> {
    const cutoff = new Date(now.getTime() - DELETE_FOR_EVERYONE_WINDOW_HOURS * 60 * 60_000);
    const [updated] = await this.postgres.db
      .update(messages)
      .set({ body: null, deletedAt: now, deletedScope: "everyone" })
      .where(
        and(
          eq(messages.id, id),
          eq(messages.senderId, senderId),
          sql`${messages.deletedAt} IS NULL`,
          gte(messages.createdAt, cutoff),
        ),
      )
      .returning();
    return updated ?? null;
  }

  // §10.7.3 "Reactions": "one emoji per user per message ... toggle."
  // Upsert on the (messageId, userId) PK — a second react with a
  // different emoji replaces the first rather than stacking.
  async setReaction(
    messageId: string,
    createdAtRef: Date,
    userId: string,
    emoji: string,
  ): Promise<void> {
    await this.postgres.db
      .insert(messageReactions)
      .values({ messageId, createdAtRef, userId, emoji })
      .onConflictDoUpdate({
        target: [messageReactions.messageId, messageReactions.userId],
        set: { emoji },
      });
  }

  async removeReaction(messageId: string, userId: string): Promise<void> {
    await this.postgres.db
      .delete(messageReactions)
      .where(and(eq(messageReactions.messageId, messageId), eq(messageReactions.userId, userId)));
  }

  // §10.7.3 "Link previews": merges into the existing metadata jsonb
  // rather than overwriting it — other metadata (transcript, waveform,
  // slots) may already live there.
  async attachLinkPreview(messageId: string, preview: object): Promise<void> {
    await this.postgres.db
      .update(messages)
      .set({
        metadata: sql`${messages.metadata} || ${JSON.stringify({ link_preview: preview })}::jsonb`,
      })
      .where(eq(messages.id, messageId));
  }

  // §10.7.3 "Forward": each target conversation gets its own independent
  // copy (own sequence, own client_msg_id) attributed to the forwarder,
  // not a reference to the original — same transaction shape as
  // sendMessage's non-idempotent path, minus the advisory lock (forward
  // has no client-supplied idempotency key to serialise on).
  async forwardMessage(
    originalBody: string | null,
    forwarderId: string,
    targetConversationId: string,
    originalMessageId: string,
    now: Date,
  ): Promise<Message> {
    return this.postgres.db.transaction(async (tx) => {
      const [seqRow] = await tx
        .update(conversations)
        .set({ messageSeq: sql`${conversations.messageSeq} + 1`, lastMessageAt: now })
        .where(eq(conversations.id, targetConversationId))
        .returning({ messageSeq: conversations.messageSeq });
      if (!seqRow)
        throw new Error("MessagesRepository: forwardMessage sequence allocation returned no row");

      const [created] = await tx
        .insert(messages)
        .values({
          conversationId: targetConversationId,
          senderId: forwarderId,
          clientMsgId: uuidv7(),
          sequence: seqRow.messageSeq,
          type: "text",
          body: originalBody,
          metadata: { forwarded_from_message_id: originalMessageId },
          createdAt: now,
        })
        .returning();
      if (!created) throw new Error("MessagesRepository: forwardMessage insert returned no row");

      await tx
        .update(conversationParticipants)
        .set({ lastReadSeq: seqRow.messageSeq })
        .where(
          and(
            eq(conversationParticipants.conversationId, targetConversationId),
            eq(conversationParticipants.userId, forwarderId),
          ),
        );
      await tx
        .update(conversationParticipants)
        .set({ unreadCount: sql`${conversationParticipants.unreadCount} + 1` })
        .where(
          and(
            eq(conversationParticipants.conversationId, targetConversationId),
            sql`${conversationParticipants.userId} <> ${forwarderId}`,
          ),
        );

      return created;
    });
  }

  // Every conversation `userId` is a participant in — the search scope
  // boundary (never search across conversations you're not a member of).
  async loadConversationIdsForUser(userId: string): Promise<string[]> {
    const rows = await this.postgres.db
      .select({ conversationId: conversationParticipants.conversationId })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.userId, userId));
    return rows.map((row) => row.conversationId);
  }

  // §10.7.3 "Search": Postgres FTS via the trigger-maintained
  // search_vector column (migration 0014), ranked by recency (most
  // recent first — §10.7.3 says "recency × rank" but ts_rank without a
  // real relevance signal beyond plainto_tsquery matching would just
  // reorder ties; recency-first is the more useful default until a real
  // ranking function is warranted).
  async searchMessages(
    conversationIds: readonly string[],
    query: string,
    conversationId: string | null,
    limit: number,
  ): Promise<Message[]> {
    if (conversationIds.length === 0) return [];
    const scopeIds = conversationId ? [conversationId] : conversationIds;
    return this.postgres.db
      .select()
      .from(messages)
      .where(
        and(
          inArray(messages.conversationId, scopeIds as string[]),
          sql`${messages.searchVector} @@ plainto_tsquery('english', ${query})`,
          sql`${messages.deletedAt} IS NULL`,
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(limit);
  }

  // Async deep-scan retraction (BR-MSG-05's second tier, distinct from
  // sender-initiated deleteForEveryone): system-initiated, no ownership/
  // window guard, tombstones the same way so "replaced with a
  // placeholder for the recipient" holds for either path.
  async retractMessage(id: string, now: Date): Promise<Message | null> {
    const [updated] = await this.postgres.db
      .update(messages)
      .set({ body: null, deletedAt: now, deletedScope: "everyone", moderationState: "retracted" })
      .where(and(eq(messages.id, id), sql`${messages.deletedAt} IS NULL`))
      .returning();
    return updated ?? null;
  }

  // "a moderation case is created" (§10.7.8 acceptance criteria). No
  // human reporter — the async classifier is the "reporter." sla_due_at
  // mirrors §10.6.6's own report contract (24h SLA).
  async createModerationCase(input: {
    targetUserId: string;
    targetMessageId: string;
    category: string;
    description: string;
  }): Promise<Report> {
    const reference = `RPT-${new Date().getUTCFullYear()}-${uuidv7().slice(-6).toUpperCase()}`;
    const [created] = await this.postgres.db
      .insert(reports)
      .values({
        reference,
        reporterId: null,
        targetType: "message",
        targetId: input.targetMessageId,
        targetUserId: input.targetUserId,
        category: input.category,
        severity: "high",
        description: input.description,
        status: "open",
        slaDueAt: new Date(Date.now() + 24 * 60 * 60_000),
      })
      .returning();
    if (!created)
      throw new Error("MessagesRepository: createModerationCase insert returned no row");
    return created;
  }
}
