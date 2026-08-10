import { apiFetch, type ConversationsListResponse } from "@/lib/api/client";

export type ConversationFilter = "all" | "unread" | "pinned" | "archived";

// One fetcher, two callers: the chats Server Component's initial SSR
// fetch and the BFF route handler's client refetch both call this, so
// the Query cache never has to distinguish where a page came from.
export async function fetchConversations(
  accessToken: string,
  filter: ConversationFilter = "all",
): Promise<ConversationsListResponse> {
  const query = filter !== "all" ? `?filter=${filter}` : "";
  return apiFetch<ConversationsListResponse>(`/conversations${query}`, { accessToken });
}
