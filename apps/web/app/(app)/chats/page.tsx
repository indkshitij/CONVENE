import { requireSession } from "@/lib/auth/guards";
import { fetchConversations } from "@/lib/chat/fetch-conversations";
import { ChatsScreen } from "@/components/chat/chats-screen";

export const metadata = { robots: { index: false, follow: false } };

// PRD §18.2: "Chat list — SSR first page, client thereafter." design.md
// §14.12 defaults to the "All" filter chip.
export default async function ChatsPage() {
  const session = await requireSession();
  const initial = await fetchConversations(session.accessToken, "all");

  return <ChatsScreen initial={initial} currentUserId={session.user.id} />;
}
