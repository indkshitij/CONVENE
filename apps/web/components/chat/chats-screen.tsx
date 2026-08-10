"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { qk } from "@/lib/api/query-keys";
import type { ConversationCard, ConversationsListResponse } from "@/lib/api/client";
import type { ConversationFilter } from "@/lib/chat/fetch-conversations";
import { usePresenceStore } from "@/stores/presence";

const FILTER_LABELS: Record<ConversationFilter, string> = {
  all: "All",
  unread: "Unread",
  pinned: "Pinned",
  archived: "Archived",
};

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")
  ).toUpperCase();
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  const withinWeek = now.getTime() - date.getTime() < 6 * 86_400_000;
  if (withinWeek) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function previewIcon(type: string | null): string {
  if (type === "voice") return "🎙 Voice note";
  if (type === "attachment") return "📎 Attachment";
  return "";
}

function isMuteActive(mutedUntil: string | null): boolean {
  return Boolean(mutedUntil && new Date(mutedUntil).getTime() > Date.now());
}

function humanizeIntent(type: string): string {
  return type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

async function fetchConversationsClient(
  filter: ConversationFilter,
): Promise<ConversationsListResponse> {
  const response = await fetch(`/api/conversations?filter=${filter}`);
  if (!response.ok) throw new Error("Failed to load conversations");
  return (await response.json()) as ConversationsListResponse;
}

export function ChatsScreen({
  initial,
  currentUserId,
}: {
  initial: ConversationsListResponse;
  currentUserId: string;
}) {
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const presenceByUserId = usePresenceStore((state) => state.byUserId);

  const queryKey = qk.conversation.list(filter);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: () => fetchConversationsClient(filter),
    ...(filter === "all" ? { initialData: initial } : {}),
  });

  const conversations = useMemo(() => {
    const list = data?.conversations ?? [];
    if (!search.trim()) return list;
    const needle = search.trim().toLowerCase();
    return list.filter(
      (conversation) =>
        (conversation.participant.full_name ?? "").toLowerCase().includes(needle) ||
        (conversation.last_message?.body_preview ?? "").toLowerCase().includes(needle),
    );
  }, [data, search]);

  const unreadCount = (data?.conversations ?? []).filter(
    (conversation) => conversation.unread_count > 0,
  ).length;

  async function updateSettings(
    id: string,
    body: { is_pinned?: boolean; muted_until?: string | null; is_archived?: boolean },
  ) {
    setOpenMenuId(null);
    await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    void queryClient.invalidateQueries({ queryKey: qk.conversation.listPrefix() });
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-16)] px-[var(--spacing-24)] py-[var(--spacing-24)]">
      <div className="flex items-center justify-between">
        <h1 className="text-[length:var(--text-heading-sm)] font-[family-name:var(--font-aeonik)] text-[color:var(--color-ink)]">
          Chats
        </h1>
        <button
          type="button"
          onClick={() => setSearchOpen((open) => !open)}
          aria-expanded={searchOpen}
          aria-label="Search conversations"
          className="min-h-11 min-w-11 rounded-[var(--radius-tags)] text-[length:var(--text-body)] text-[color:var(--color-ink)]"
        >
          🔍
        </button>
      </div>

      {searchOpen && (
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search chats"
          aria-label="Search chats"
          className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
        />
      )}

      {/* P29.3: at 320px width (design.md §15's "usable at ... 320px
          width" a11y requirement) these 4 chips don't fit their
          container without wrapping or scrolling — an unconstrained
          `flex` row here overflowed the page horizontally (WCAG 1.4.10
          Reflow violation, caught by zoom-reflow.spec.ts). Horizontal
          scroll (not wrap) matches this app's existing convention for
          chip rows on narrow screens — see available-now-carousel,
          settings-screen, premium-screen. */}
      <div
        role="tablist"
        aria-label="Chat filters"
        className="flex gap-[var(--spacing-8)] overflow-x-auto"
      >
        {(Object.entries(FILTER_LABELS) as [ConversationFilter, string][]).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
            className={`min-h-11 rounded-[var(--radius-tags)] border px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)] ${filter === value ? "border-[color:var(--color-iris-blue)] bg-[color:var(--color-lavender-wash)] text-[color:var(--color-ink)]" : "border-[color:var(--color-mist-gray)] text-[color:var(--color-ink)]"}`}
          >
            {label}
            {value === "unread" && unreadCount > 0 ? ` ${unreadCount}` : ""}
          </button>
        ))}
      </div>

      {isError && (
        <div
          role="alert"
          className="rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]"
        >
          <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
            Couldn&apos;t load your chats.
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
          {[0, 1, 2, 3, 4].map((index) => (
            <div
              key={index}
              className="h-16 w-full animate-pulse rounded-[var(--radius-cards)] bg-[color:var(--color-mist-gray)]"
            />
          ))}
        </div>
      )}

      {!isError && !isLoading && conversations.length === 0 && (
        <div className="rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-24)] text-center">
          <p className="text-[length:var(--text-body)] text-[color:var(--color-ink)]">
            Your conversations will appear here. Connect with someone to start.
          </p>
          <Link
            href="/discover"
            className="mt-[var(--spacing-16)] inline-block min-h-11 rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-8 py-3 text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)]"
          >
            Discover people
          </Link>
        </div>
      )}

      {!isError && !isLoading && conversations.length > 0 && (
        <ul className="flex flex-col gap-[var(--spacing-8)]">
          {conversations.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              currentUserId={currentUserId}
              online={
                conversation.participant.user_id
                  ? (presenceByUserId[conversation.participant.user_id]?.online ?? false)
                  : false
              }
              menuOpen={openMenuId === conversation.id}
              onToggleMenu={() =>
                setOpenMenuId((current) => (current === conversation.id ? null : conversation.id))
              }
              onPin={() =>
                void updateSettings(conversation.id, { is_pinned: !conversation.is_pinned })
              }
              onMute={() =>
                void updateSettings(conversation.id, {
                  muted_until: conversation.is_muted_until
                    ? null
                    : new Date(Date.now() + 30 * 86_400_000).toISOString(),
                })
              }
              onArchive={() =>
                void updateSettings(conversation.id, { is_archived: !conversation.is_archived })
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ConversationRow({
  conversation,
  currentUserId,
  online,
  menuOpen,
  onToggleMenu,
  onPin,
  onMute,
  onArchive,
}: {
  conversation: ConversationCard;
  currentUserId: string;
  online: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onPin: () => void;
  onMute: () => void;
  onArchive: () => void;
}) {
  const isMuted = isMuteActive(conversation.is_muted_until);
  const isOwnMessage = conversation.last_message?.sender_id === currentUserId;
  const previewBody = conversation.last_message
    ? previewIcon(conversation.last_message.type) || conversation.last_message.body_preview || ""
    : "Say hello to get started.";
  const previewText =
    isOwnMessage && conversation.last_message ? `You: ${previewBody}` : previewBody;

  return (
    <li className="relative flex items-center gap-[var(--spacing-16)] rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]">
      <Link
        href={`/chats/${conversation.id}`}
        className="flex flex-1 items-center gap-[var(--spacing-16)] no-underline"
      >
        <div className="relative">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[color:var(--color-lavender-wash)] text-[length:var(--text-body-sm)] font-semibold text-[color:var(--color-ink)]">
            {initials(conversation.participant.full_name)}
          </div>
          <span
            aria-hidden="true"
            className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[color:var(--color-paper-white)]"
            style={{
              backgroundColor: online
                ? "var(--availability-available-now)"
                : "var(--availability-offline)",
            }}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-[var(--spacing-4)]">
          <div className="flex items-center justify-between gap-[var(--spacing-8)]">
            <span className="flex items-center gap-1 truncate text-[length:var(--text-body-sm)] font-medium text-[color:var(--color-ink)]">
              {conversation.is_pinned && <span aria-label="Pinned">📌</span>}
              {conversation.participant.full_name ?? "Member"}
            </span>
            <span className="shrink-0 text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
              {formatTimestamp(conversation.last_message?.created_at ?? null)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-[var(--spacing-8)]">
            <span className="truncate text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
              {previewText}
            </span>
            <div className="flex shrink-0 items-center gap-[var(--spacing-4)]">
              {isMuted && <span aria-label="Muted">🔇</span>}
              {conversation.unread_count > 0 && (
                <span className="min-w-5 rounded-full bg-[color:var(--color-iris-blue)] px-2 py-0.5 text-center text-[length:var(--text-caption)] text-[color:var(--color-paper-white)]">
                  {conversation.unread_count}
                </span>
              )}
            </div>
          </div>
          {conversation.connection.intent && (
            <span className="truncate text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
              🎯 Connected via: {humanizeIntent(conversation.connection.intent)}
            </span>
          )}
        </div>
      </Link>

      <button
        type="button"
        onClick={onToggleMenu}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="Conversation actions"
        className="min-h-11 min-w-11 shrink-0 text-[color:var(--color-graphite)]"
      >
        ⋯
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-4 top-14 z-10 flex flex-col rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] bg-[color:var(--color-paper-white)] py-[var(--spacing-8)] shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={onPin}
            className="min-h-11 px-[var(--spacing-16)] text-left text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
          >
            {conversation.is_pinned ? "Unpin" : "Pin"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={onMute}
            className="min-h-11 px-[var(--spacing-16)] text-left text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
          >
            {isMuted ? "Unmute" : "Mute"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={onArchive}
            className="min-h-11 px-[var(--spacing-16)] text-left text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
          >
            {conversation.is_archived ? "Unarchive" : "Archive"}
          </button>
        </div>
      )}
    </li>
  );
}
