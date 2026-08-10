import { conversationParticipants, conversations, type Conversation } from "@convene/db";
import { Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { PostgresService } from "../../../infra/postgres/postgres.service";

export type ConversationFilter = "all" | "unread" | "pinned" | "archived";

export interface ConversationListRow {
  conversationId: string;
  state: string;
  unreadCount: number;
  lastReadSeq: number;
  isPinned: boolean;
  isArchived: boolean;
  mutedUntil: Date | null;
  otherUserId: string | null;
  otherFullName: string | null;
  intentType: string | null;
  lastMessageBody: string | null;
  lastMessageSenderId: string | null;
  lastMessageCreatedAt: Date | null;
  lastMessageType: string | null;
}

@Injectable()
export class ConversationsRepository {
  constructor(private readonly postgres: PostgresService) {}

  async findConversationById(id: string): Promise<Conversation | null> {
    const [row] = await this.postgres.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);
    return row ?? null;
  }

  async loadParticipant(conversationId: string, userId: string) {
    const [row] = await this.postgres.db
      .select()
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  // §10.7.6: `GET /conversations?filter=all|unread|pinned|archived`.
  // Ordered by pin priority first, then last activity — same "is_pinned
  // DESC" priority idx_cp_user_list itself is built for. The "Connected
  // via {intent}" context comes from conversations.connection_id ->
  // connections.intent_id -> user_intents.type (nullable throughout:
  // Instant Chat conversations have no connection_id at all).
  async listForUser(
    userId: string,
    filter: ConversationFilter,
    limit: number,
  ): Promise<ConversationListRow[]> {
    const filterClause =
      filter === "unread"
        ? sql`AND cp.unread_count > 0`
        : filter === "pinned"
          ? sql`AND cp.is_pinned = true`
          : filter === "archived"
            ? sql`AND cp.is_archived = true`
            : sql`AND cp.is_archived = false`;

    const rows = await this.postgres.db.execute<{
      conversation_id: string;
      state: string;
      unread_count: number;
      last_read_seq: string;
      is_pinned: boolean;
      is_archived: boolean;
      muted_until: Date | null;
      other_user_id: string | null;
      other_full_name: string | null;
      intent_type: string | null;
      last_message_body: string | null;
      last_message_sender_id: string | null;
      last_message_created_at: Date | null;
      last_message_type: string | null;
    }>(sql`
      SELECT
        c.id AS conversation_id, c.state,
        cp.unread_count, cp.last_read_seq, cp.is_pinned, cp.is_archived, cp.muted_until,
        other.id AS other_user_id, other.full_name AS other_full_name,
        ui.type AS intent_type,
        lm.body AS last_message_body, lm.sender_id AS last_message_sender_id,
        lm.created_at AS last_message_created_at, lm.type AS last_message_type
      FROM conversation_participants cp
      JOIN conversations c ON c.id = cp.conversation_id
      LEFT JOIN conversation_participants other_cp ON other_cp.conversation_id = c.id AND other_cp.user_id <> cp.user_id
      LEFT JOIN users other ON other.id = other_cp.user_id
      LEFT JOIN connections conn ON conn.id = c.connection_id
      LEFT JOIN user_intents ui ON ui.id = conn.intent_id
      LEFT JOIN LATERAL (
        SELECT body, sender_id, created_at, type FROM messages m
        WHERE m.conversation_id = c.id ORDER BY m.sequence DESC LIMIT 1
      ) lm ON true
      WHERE cp.user_id = ${userId} ${filterClause}
      ORDER BY cp.is_pinned DESC, c.last_message_at DESC NULLS LAST, c.id
      LIMIT ${limit}
    `);

    return rows.map((row) => ({
      conversationId: row.conversation_id,
      state: row.state,
      unreadCount: row.unread_count,
      lastReadSeq: Number(row.last_read_seq),
      isPinned: row.is_pinned,
      isArchived: row.is_archived,
      mutedUntil: row.muted_until,
      otherUserId: row.other_user_id,
      otherFullName: row.other_full_name,
      intentType: row.intent_type,
      lastMessageBody: row.last_message_body,
      lastMessageSenderId: row.last_message_sender_id,
      lastMessageCreatedAt: row.last_message_created_at,
      lastMessageType: row.last_message_type,
    }));
  }

  async countPinned(userId: string): Promise<number> {
    const [row] = await this.postgres.db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.userId, userId),
          eq(conversationParticipants.isPinned, true),
        ),
      );
    return row?.count ?? 0;
  }

  async updateSettings(
    conversationId: string,
    userId: string,
    patch: { isPinned?: boolean; mutedUntil?: Date | null; isArchived?: boolean },
  ): Promise<void> {
    await this.postgres.db
      .update(conversationParticipants)
      .set(patch)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId),
        ),
      );
  }

  // BR (§10.7.9 edge case 12): "last_read_seq moves monotonically forward
  // only (GREATEST)." unread_count is recomputed exactly from the real
  // message count past the new read cursor, not just decremented, so it
  // can never drift out of sync with what's actually unread.
  async markRead(
    conversationId: string,
    userId: string,
    upToSequence: number,
  ): Promise<{ previousLastReadSeq: number; newLastReadSeq: number }> {
    const [before] = await this.postgres.db
      .select({ lastReadSeq: conversationParticipants.lastReadSeq })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId),
        ),
      )
      .limit(1);
    const previousLastReadSeq = before?.lastReadSeq ?? 0;

    const [row] = await this.postgres.db.execute<{
      unread_count: number;
      last_read_seq: string;
    }>(sql`
      UPDATE conversation_participants
      SET last_read_seq = GREATEST(last_read_seq, ${upToSequence}),
          unread_count = (
            SELECT count(*)::int FROM messages m
            WHERE m.conversation_id = ${conversationId} AND m.sequence > GREATEST(last_read_seq, ${upToSequence})
          )
      WHERE conversation_id = ${conversationId} AND user_id = ${userId}
      RETURNING unread_count, last_read_seq
    `);

    return {
      previousLastReadSeq,
      newLastReadSeq: row ? Number(row.last_read_seq) : previousLastReadSeq,
    };
  }

  // Message ids newly covered by a read-to-sequence call — used to
  // cancel their still-pending 8s delayed push jobs (BR-MSG-06).
  async loadMessageIdsInSequenceRange(
    conversationId: string,
    fromExclusive: number,
    toInclusive: number,
  ): Promise<string[]> {
    if (toInclusive <= fromExclusive) return [];
    const rows = await this.postgres.db.execute<{ id: string }>(sql`
      SELECT id FROM messages WHERE conversation_id = ${conversationId} AND sequence > ${fromExclusive} AND sequence <= ${toInclusive}
    `);
    return rows.map((row) => row.id);
  }
}
