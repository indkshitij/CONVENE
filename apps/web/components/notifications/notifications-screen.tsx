"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import type { NotificationCard, NotificationsListResponse } from "@/lib/api/client";

// apps/api's real 15-category vocabulary (notification-catalogue.ts) —
// only `request_accepted` and `moderation_action` have a real trigger
// call site anywhere in apps/api today (grepped every notify() call);
// the rest are declared in the catalogue (and configurable in
// preferences) but nothing fires them yet. All 15 still get an icon here
// since the filter dropdown and Settings' preferences matrix both need
// the full real category list, not just the ones currently live.
const CATEGORY_ICONS: Record<string, string> = {
  new_match_high: "✦",
  connection_request: "👤",
  request_accepted: "🤝",
  new_message: "💬",
  availability_expiring: "⏰",
  availability_window_starting: "🟢",
  convene_hours_starting: "📅",
  intent_expiring: "🎯",
  saved_search_alert: "🔎",
  profile_view: "👁",
  weekly_digest: "📊",
  reputation_change: "★",
  moderation_action: "⚠",
  security_alert: "🔒",
  plan_billing: "💳",
};

function isToday(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString();
}

async function fetchNotifications(filter: "all" | "unread"): Promise<NotificationsListResponse> {
  const response = await fetch(`/api/notifications?filter=${filter}`);
  if (!response.ok) throw new Error("Failed to load notifications");
  return (await response.json()) as NotificationsListResponse;
}

export function NotificationsScreen({ initial }: { initial: NotificationsListResponse }) {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["notifications", filter],
    queryFn: () => fetchNotifications(filter),
    ...(filter === "all" ? { initialData: initial } : {}),
  });

  async function markRead(ids: string[]) {
    await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }

  async function markAllRead() {
    await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }

  const notifications = data?.notifications ?? [];
  const today = notifications.filter((notification) => isToday(notification.created_at));
  const earlier = notifications.filter((notification) => !isToday(notification.created_at));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-[var(--spacing-16)] px-[var(--spacing-24)] py-[var(--spacing-24)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-[var(--spacing-8)]">
          <Link
            href="/home"
            aria-label="Back"
            className="min-h-11 min-w-11 content-center text-[length:var(--text-body)] text-[color:var(--color-ink)]"
          >
            ←
          </Link>
          <h1 className="text-[length:var(--text-heading-sm)] font-[family-name:var(--font-aeonik)] text-[color:var(--color-ink)]">
            Notifications
          </h1>
        </div>
        {data && data.unread_count > 0 && (
          <button
            type="button"
            onClick={() => void markAllRead()}
            className="min-h-11 text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)] underline"
          >
            Mark all read
          </button>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div
          role="tablist"
          aria-label="Notification filter"
          className="flex gap-[var(--spacing-8)]"
        >
          <button
            role="tab"
            aria-selected={filter === "all"}
            onClick={() => setFilter("all")}
            className={`min-h-11 rounded-[var(--radius-tags)] border px-[var(--spacing-16)] text-[length:var(--text-body-sm)] ${filter === "all" ? "border-[color:var(--color-iris-blue)] bg-[color:var(--color-lavender-wash)] text-[color:var(--color-ink)]" : "border-[color:var(--color-mist-gray)] text-[color:var(--color-ink)]"}`}
          >
            All
          </button>
          <button
            role="tab"
            aria-selected={filter === "unread"}
            onClick={() => setFilter("unread")}
            className={`min-h-11 rounded-[var(--radius-tags)] border px-[var(--spacing-16)] text-[length:var(--text-body-sm)] ${filter === "unread" ? "border-[color:var(--color-iris-blue)] bg-[color:var(--color-lavender-wash)] text-[color:var(--color-ink)]" : "border-[color:var(--color-mist-gray)] text-[color:var(--color-ink)]"}`}
          >
            Unread
          </button>
        </div>
        <Link
          href="/settings/notifications"
          className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]"
        >
          ⚙ Settings
        </Link>
      </div>

      {isError && (
        <div
          role="alert"
          className="rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]"
        >
          <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
            Couldn&apos;t load notifications.
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-[var(--spacing-8)] min-h-11 text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)] underline"
          >
            Try again
          </button>
        </div>
      )}

      {!isError && isLoading && (
        <div className="flex flex-col gap-[var(--spacing-8)]">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="h-16 w-full animate-pulse rounded-[var(--radius-cards)] bg-[color:var(--color-mist-gray)]"
            />
          ))}
        </div>
      )}

      {!isError && !isLoading && notifications.length === 0 && (
        <div className="rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-24)] text-center">
          <p className="text-[length:var(--text-body)] text-[color:var(--color-ink)]">
            You&apos;re all caught up.
          </p>
        </div>
      )}

      {today.length > 0 && (
        <NotificationGroup title="Today" notifications={today} onMarkRead={markRead} />
      )}
      {earlier.length > 0 && (
        <NotificationGroup title="Earlier" notifications={earlier} onMarkRead={markRead} />
      )}
    </div>
  );
}

function NotificationGroup({
  title,
  notifications,
  onMarkRead,
}: {
  title: string;
  notifications: NotificationCard[];
  onMarkRead: (ids: string[]) => void;
}) {
  return (
    <section className="flex flex-col gap-[var(--spacing-8)]">
      <h2 className="text-[length:var(--text-caption)] font-medium uppercase tracking-wide text-[color:var(--color-graphite)]">
        {title}
      </h2>
      <ul className="flex flex-col gap-[var(--spacing-8)]">
        {notifications.map((notification) => (
          <NotificationRow
            key={notification.id}
            notification={notification}
            onMarkRead={onMarkRead}
          />
        ))}
      </ul>
    </section>
  );
}

function NotificationRow({
  notification,
  onMarkRead,
}: {
  notification: NotificationCard;
  onMarkRead: (ids: string[]) => void;
}) {
  const isUnread = !notification.read_at;
  const conversationId =
    typeof notification.data.conversationId === "string" ? notification.data.conversationId : null;
  const time = new Date(notification.created_at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  function handleTap() {
    if (isUnread) onMarkRead([notification.id]);
  }

  // Interactive controls can't nest (the "mark as read" tap target and
  // the "Message" link would both be interactive) — the tappable part is
  // a `<button>` covering everything except the Message link, which sits
  // as a sibling after it rather than a descendant.
  const content = (
    <>
      <span aria-hidden="true" className="mt-1 shrink-0">
        {isUnread ? "●" : "○"} {CATEGORY_ICONS[notification.category] ?? "•"}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-left">
        <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
          {notification.title}
        </p>
        {notification.body && (
          <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
            {notification.body}
          </p>
        )}
        <span className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
          {time}
        </span>
      </div>
    </>
  );

  return (
    <li
      className="flex items-start gap-[var(--spacing-16)] rounded-[var(--radius-cards)] border p-[var(--spacing-16)]"
      style={{
        borderColor: "var(--color-mist-gray)",
        backgroundColor: isUnread ? "var(--color-lavender-wash)" : "transparent",
      }}
    >
      {isUnread ? (
        <button
          type="button"
          onClick={handleTap}
          aria-label={`${notification.title}. Mark as read.`}
          className="flex flex-1 items-start gap-[var(--spacing-16)]"
        >
          {content}
        </button>
      ) : (
        <div className="flex flex-1 items-start gap-[var(--spacing-16)]">{content}</div>
      )}
      {conversationId && (
        <Link
          href={`/chats/${conversationId}`}
          className="min-h-11 shrink-0 content-center text-[length:var(--text-caption)] underline"
          style={{ color: isUnread ? "var(--color-charcoal)" : "var(--color-iris-blue)" }}
        >
          Message
        </Link>
      )}
    </li>
  );
}
