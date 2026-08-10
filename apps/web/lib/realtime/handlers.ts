import type { QueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/api/query-keys";
import { usePresenceStore } from "@/stores/presence";

// Mirrors apps/realtime's socket.gateway.ts real, currently-shipping
// protocol (confirmed by reading that file directly, not PRD prose,
// which documents a different/stale scheme in §10.7.5) — nothing here
// is imported from packages/types/packages/validation because neither
// package defines these shapes yet (apps/realtime and apps/api each
// hand-roll their own local copy too, for the same "apps may not import
// apps" reason); this is apps/web's own copy of that same gap, not a
// rule-6 violation.
export type SubscribeScope = "conversation" | "presence" | "admin_reports";
export type EventChannel = SubscribeScope | "user";

export interface RealtimeEventEnvelope {
  type: "event";
  channel: EventChannel;
  id?: string;
  sequence: number;
  event: string;
  payload: unknown;
}

export interface ResyncRequiredEnvelope {
  type: "resync_required";
}

export interface ErrorEnvelope {
  type: "error";
  message: string;
}

export type ServerFrame = RealtimeEventEnvelope | ResyncRequiredEnvelope | ErrorEnvelope;

export function parseServerFrame(raw: string): ServerFrame | null {
  try {
    const parsed = JSON.parse(raw) as { type?: unknown };
    if (parsed.type === "event" || parsed.type === "resync_required" || parsed.type === "error") {
      return parsed as ServerFrame;
    }
    return null;
  } catch {
    return null;
  }
}

// Mirrors messages.service.ts's toWirePayload — the message.sent /
// message.updated payload shape.
interface MessageWirePayload {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  client_msg_id: string;
  sequence: number;
  type: string;
  body: string | null;
  reply_to_id: string | null;
  attachments: unknown[];
  created_at: string;
  deleted_at?: string | null;
}

function upsertMessage(
  list: MessageWirePayload[] | undefined,
  incoming: MessageWirePayload,
): MessageWirePayload[] {
  const existing = list ?? [];
  // Dedupe on `id` (server-assigned) first; if this is the send's own
  // optimistic entry not yet reconciled, `client_msg_id` still matches —
  // the server's idempotency on client_msg_id (§18.3's outbox note) is
  // exactly what makes this dedupe safe.
  const index = existing.findIndex(
    (message) => message.id === incoming.id || message.client_msg_id === incoming.client_msg_id,
  );
  if (index === -1) return [...existing, incoming].sort((a, b) => a.sequence - b.sequence);
  const next = existing.slice();
  next[index] = incoming;
  return next;
}

// §18.3: "the WebSocket never owns data — handlers only mutate the
// Query cache, so a socket event and a refetch converge on the same
// state." This function is the one place that's true: every branch
// below either calls `queryClient.setQueryData`/`invalidateQueries`
// (server-data entities: messages, media) using the exact same key a
// `useQuery` for that entity would use, or — for `presence`/the current
// user's own `availability`, neither of which has a REST resource per
// §18.3's own state-split table (Zustand owns them outright, there's
// nothing for a refetch to converge with) — writes to the matching
// Zustand store instead. Nothing here keeps a private copy of anything.
export function applyRealtimeEvent(
  queryClient: QueryClient,
  frame: RealtimeEventEnvelope,
  currentUserId: string | null,
): void {
  if (frame.channel === "conversation" && frame.id) {
    const conversationId = frame.id;
    switch (frame.event) {
      case "message.sent":
      case "message.updated": {
        const message = frame.payload as MessageWirePayload;
        queryClient.setQueryData<MessageWirePayload[]>(
          qk.conversation.messages(conversationId),
          (existing) => upsertMessage(existing, message),
        );
        void queryClient.invalidateQueries({ queryKey: qk.conversation.listPrefix() });
        return;
      }
      case "message.deleted": {
        const { message_id: messageId } = frame.payload as { message_id: string };
        queryClient.setQueryData<MessageWirePayload[]>(
          qk.conversation.messages(conversationId),
          (existing) =>
            (existing ?? []).map((message) =>
              message.id === messageId
                ? { ...message, deleted_at: new Date().toISOString() }
                : message,
            ),
        );
        return;
      }
      case "reaction.updated": {
        // No per-message reactions field is modeled in MessageWirePayload
        // yet (P23.2's own scope) — a refetch is the correct, honest
        // fallback rather than guessing at a shape that isn't real yet.
        void queryClient.invalidateQueries({ queryKey: qk.conversation.messages(conversationId) });
        return;
      }
      default:
        return;
    }
  }

  if (frame.channel === "user") {
    switch (frame.event) {
      case "media.ready": {
        const { media_id: mediaId } = frame.payload as { media_id: string };
        void queryClient.invalidateQueries({ queryKey: ["media", mediaId] });
        return;
      }
      default:
        // An unrecognised rt:user event (notifications, quota changes,
        // request accepted, etc. — §17.5's own list, not all built yet)
        // gets a broad, safe default: refetch notifications rather than
        // silently drop it.
        void queryClient.invalidateQueries({ queryKey: qk.notifications.list() });
        return;
    }
  }

  if (frame.channel === "presence") {
    const { userId } = frame.payload as { userId: string; state: string };
    usePresenceStore.getState().setPresence(userId, {
      online: frame.event === "availability.started",
      lastSeenAt: new Date().toISOString(),
    });
    // The current user's own availability *does* have a real REST
    // resource (GET /availability/me, P21.1) — unlike arbitrary other
    // users' coarse presence above, §18.3's rule puts this in the Query
    // cache, not a bespoke store. The rt:presence:{geohash5} payload is
    // deliberately coarse (userId + state only, BR-AVAIL-16 — see
    // apps/api's presence-broadcast.listener.ts) and never carries this
    // user's real expires_at, so this can only trigger a refetch of the
    // authoritative session, never synthesize one from the partial event.
    if (currentUserId && userId === currentUserId) {
      void queryClient.invalidateQueries({ queryKey: qk.availability.me() });
    }
  }
}
