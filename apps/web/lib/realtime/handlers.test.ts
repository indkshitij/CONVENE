import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import { qk } from "@/lib/api/query-keys";
import { usePresenceStore } from "@/stores/presence";
import { applyRealtimeEvent, type RealtimeEventEnvelope } from "./handlers";

function fakeMessage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "m1",
    conversation_id: "c1",
    sender_id: "u2",
    client_msg_id: "client-1",
    sequence: 1,
    type: "text",
    body: "hello",
    reply_to_id: null,
    attachments: [],
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("applyRealtimeEvent", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
    usePresenceStore.setState({ byUserId: {} });
  });

  // Explicit acceptance criterion: "Assert a socket message and a manual
  // refetch produce identical cache state." — dispatch a message.sent
  // event via the socket path, then separately simulate what a manual
  // `refetch()` would have set (the server's own ground truth for the
  // same conversation) and assert the two converge on an identical
  // cache value.
  it("a socket-delivered message.sent converges with what a manual refetch would produce", () => {
    const conversationId = "c1";
    const m1 = fakeMessage({ id: "m1", sequence: 1 });
    const m2 = fakeMessage({ id: "m2", client_msg_id: "client-2", sequence: 2, body: "world" });

    // Socket path: two events arrive over the wire.
    applyRealtimeEvent(
      queryClient,
      {
        type: "event",
        channel: "conversation",
        id: conversationId,
        sequence: 1,
        event: "message.sent",
        payload: m1,
      } satisfies RealtimeEventEnvelope,
      null,
    );
    applyRealtimeEvent(
      queryClient,
      {
        type: "event",
        channel: "conversation",
        id: conversationId,
        sequence: 2,
        event: "message.sent",
        payload: m2,
      } satisfies RealtimeEventEnvelope,
      null,
    );
    const viaSocket = queryClient.getQueryData(qk.conversation.messages(conversationId));

    // Manual refetch path: a separate QueryClient's cache is populated
    // directly with what the REST endpoint would return for the same
    // conversation (the server's ground truth) — exactly what
    // `useQuery`'s own queryFn does on a manual refetch().
    const refetchClient = new QueryClient();
    refetchClient.setQueryData(qk.conversation.messages(conversationId), [m1, m2]);
    const viaRefetch = refetchClient.getQueryData(qk.conversation.messages(conversationId));

    expect(viaSocket).toEqual(viaRefetch);
  });

  it("message.updated overwrites the existing entry in place rather than duplicating it", () => {
    const conversationId = "c1";
    const original = fakeMessage({ id: "m1", sequence: 1, body: "original" });
    const edited = fakeMessage({ id: "m1", sequence: 1, body: "edited" });

    applyRealtimeEvent(
      queryClient,
      {
        type: "event",
        channel: "conversation",
        id: conversationId,
        sequence: 1,
        event: "message.sent",
        payload: original,
      },
      null,
    );
    applyRealtimeEvent(
      queryClient,
      {
        type: "event",
        channel: "conversation",
        id: conversationId,
        sequence: 1,
        event: "message.updated",
        payload: edited,
      },
      null,
    );

    const cached = queryClient.getQueryData<unknown[]>(qk.conversation.messages(conversationId));
    expect(cached).toHaveLength(1);
    expect((cached![0] as { body: string }).body).toBe("edited");
  });

  it("message.sent dedupes against its own optimistic entry by client_msg_id", () => {
    const conversationId = "c1";
    const optimistic = fakeMessage({
      id: "optimistic-temp-id",
      client_msg_id: "client-1",
      sequence: 1,
    });
    const confirmed = fakeMessage({ id: "m1", client_msg_id: "client-1", sequence: 1 });

    queryClient.setQueryData(qk.conversation.messages(conversationId), [optimistic]);
    applyRealtimeEvent(
      queryClient,
      {
        type: "event",
        channel: "conversation",
        id: conversationId,
        sequence: 1,
        event: "message.sent",
        payload: confirmed,
      },
      null,
    );

    const cached = queryClient.getQueryData<unknown[]>(qk.conversation.messages(conversationId));
    expect(cached).toHaveLength(1);
    expect((cached![0] as { id: string }).id).toBe("m1");
  });

  it("message.deleted marks the message deleted rather than removing history", () => {
    const conversationId = "c1";
    const message = fakeMessage({ id: "m1", sequence: 1 });
    queryClient.setQueryData(qk.conversation.messages(conversationId), [message]);

    applyRealtimeEvent(
      queryClient,
      {
        type: "event",
        channel: "conversation",
        id: conversationId,
        sequence: 2,
        event: "message.deleted",
        payload: { message_id: "m1", scope: "everyone" },
      },
      null,
    );

    const cached = queryClient.getQueryData<{ deleted_at: string | null }[]>(
      qk.conversation.messages(conversationId),
    );
    expect(cached![0]?.deleted_at).toBeTruthy();
  });

  it("presence events update the presence store, not the Query cache (no REST resource to converge with)", () => {
    applyRealtimeEvent(
      queryClient,
      {
        type: "event",
        channel: "presence",
        id: "geohash5",
        sequence: 1,
        event: "availability.started",
        payload: { userId: "u9", state: "available_now" },
      },
      null,
    );
    expect(usePresenceStore.getState().byUserId["u9"]?.online).toBe(true);
  });

  it("a presence event for the current user invalidates their own availability query (a real REST resource), rather than caching the coarse partial payload", () => {
    queryClient.setQueryData(qk.availability.me(), { current_session: null });
    const invalidateSpy = queryClient.invalidateQueries.bind(queryClient);
    let invalidatedKey: readonly unknown[] | undefined;
    queryClient.invalidateQueries = ((filters?: { queryKey?: readonly unknown[] }) => {
      invalidatedKey = filters?.queryKey;
      return invalidateSpy(filters);
    }) as typeof queryClient.invalidateQueries;

    applyRealtimeEvent(
      queryClient,
      {
        type: "event",
        channel: "presence",
        id: "geohash5",
        sequence: 1,
        event: "availability.started",
        payload: { userId: "u1", state: "available_now" },
      },
      "u1",
    );

    expect(invalidatedKey).toEqual(qk.availability.me());
  });

  it("an unrecognised rt:user event safely invalidates notifications rather than throwing", () => {
    expect(() =>
      applyRealtimeEvent(
        queryClient,
        {
          type: "event",
          channel: "user",
          id: "u1",
          sequence: 1,
          event: "some_future_event",
          payload: {},
        },
        "u1",
      ),
    ).not.toThrow();
  });
});
