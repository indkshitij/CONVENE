import { apiFetch, type NotificationsListResponse } from "@/lib/api/client";
import { requireSession } from "@/lib/auth/guards";
import { NotificationsScreen } from "@/components/notifications/notifications-screen";

export const metadata = { robots: { index: false, follow: false } };

export default async function NotificationsPage() {
  const session = await requireSession();
  const initial = await apiFetch<NotificationsListResponse>("/notifications", {
    accessToken: session.accessToken,
  });

  return <NotificationsScreen initial={initial} />;
}
