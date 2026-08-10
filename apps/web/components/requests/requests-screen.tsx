"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { qk } from "@/lib/api/query-keys";
import type {
  HydratedRequestCard,
  HydratedRequestsListResponse,
  IntentTaxonomyEntry,
} from "@/lib/api/client";
import { pushToast } from "@/stores/ui";

type Tab = "received" | "sent";
type SortMode = "score_desc" | "recent" | "expiring_soon";

const SORT_LABELS: Record<SortMode, string> = {
  score_desc: "Best match",
  recent: "Newest",
  expiring_soon: "Expiring soon",
};
// BR-CONN-04: requests expire after 14 days — a request inside the last
// 3 of those is what "expiring soon" means for the bulk-decline action.
// No exact threshold is given anywhere in design.md/the PRD for this
// bulk action; 3 days is a defensible, documented choice, not a
// transcription.
const EXPIRING_SOON_DAYS = 3;

function humanize(type: string): string {
  return type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

async function fetchRequests(
  direction: Tab,
  status: string | undefined,
  sort: string,
): Promise<HydratedRequestsListResponse> {
  const query = new URLSearchParams({ direction, sort });
  if (status) query.set("status", status);
  const response = await fetch(`/api/connections/requests?${query.toString()}`);
  if (!response.ok) throw new Error("Failed to load requests");
  return (await response.json()) as HydratedRequestsListResponse;
}

export function RequestsScreen({
  initialReceived,
  taxonomy,
}: {
  initialReceived: HydratedRequestsListResponse;
  taxonomy: IntentTaxonomyEntry[];
}) {
  const [tab, setTab] = useState<Tab>("received");
  const [sort, setSort] = useState<SortMode>("score_desc");
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  // "Expiring soon" (design.md §14.11's sort control) has no server-side
  // sort mode (RequestSort is score_desc/recent only, grepped
  // connections.repository.ts) — fetched as "recent" and re-sorted by
  // expires_at client-side instead of silently dropping the option.
  const serverSort = sort === "expiring_soon" ? "recent" : sort;
  const status = tab === "received" ? "pending" : undefined;
  const queryKey = qk.requests.list(tab, status, serverSort);
  const isInitialView = tab === "received" && serverSort === "score_desc";

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: () => fetchRequests(tab, status, serverSort),
    ...(isInitialView ? { initialData: initialReceived } : {}),
  });

  const requests = useMemo(() => {
    const list = data?.requests ?? [];
    if (sort !== "expiring_soon") return list;
    return [...list].sort(
      (a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime(),
    );
  }, [data, sort]);

  function toggleNote(id: string) {
    setExpandedNoteIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function acceptRequest(request: HydratedRequestCard) {
    const response = await fetch(`/api/connections/requests/${request.id}/accept`, {
      method: "POST",
    });
    if (!response.ok) {
      pushToast({ variant: "error", message: "Couldn't accept this request. Please try again." });
      return;
    }
    pushToast({
      variant: "success",
      message: `You're connected with ${request.counterparty?.full_name ?? "them"}.`,
      durationMs: 4000,
    });
    void queryClient.invalidateQueries({ queryKey });
  }

  async function declineRequest(id: string) {
    await fetch(`/api/connections/requests/${id}/reject`, { method: "POST" });
    void queryClient.invalidateQueries({ queryKey });
  }

  async function withdrawRequest(id: string) {
    await fetch(`/api/connections/requests/${id}`, { method: "DELETE" });
    void queryClient.invalidateQueries({ queryKey });
  }

  // design.md §14.11's "bulk Decline all expiring" — no bulk-reject
  // endpoint exists (grepped connections.controller.ts: only per-id POST
  // .../:id/reject) — implemented as sequential calls to the real
  // endpoint rather than left unbuilt, since the underlying single-item
  // action is real.
  async function declineAllExpiring() {
    const expiring = requests.filter(
      (request) =>
        request.status === "pending" && daysUntil(request.expires_at) <= EXPIRING_SOON_DAYS,
    );
    for (const request of expiring) {
      await fetch(`/api/connections/requests/${request.id}/reject`, { method: "POST" });
    }
    void queryClient.invalidateQueries({ queryKey });
  }

  const expiringCount =
    tab === "received"
      ? requests.filter(
          (request) =>
            request.status === "pending" && daysUntil(request.expires_at) <= EXPIRING_SOON_DAYS,
        ).length
      : 0;

  return (
    <div className="flex flex-col gap-[var(--spacing-16)] px-[var(--spacing-24)] py-[var(--spacing-24)]">
      <h1 className="text-[length:var(--text-heading-sm)] font-[family-name:var(--font-aeonik)] text-[color:var(--color-ink)]">
        Requests
      </h1>

      <div role="tablist" aria-label="Requests direction" className="flex gap-[var(--spacing-8)]">
        <button
          role="tab"
          aria-selected={tab === "received"}
          onClick={() => setTab("received")}
          className={`min-h-11 rounded-[var(--radius-tags)] border px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)] ${tab === "received" ? "border-[color:var(--color-iris-blue)] bg-[color:var(--color-lavender-wash)] text-[color:var(--color-ink)]" : "border-[color:var(--color-mist-gray)] text-[color:var(--color-ink)]"}`}
        >
          Received{tab === "received" && data ? ` (${requests.length})` : ""}
        </button>
        <button
          role="tab"
          aria-selected={tab === "sent"}
          onClick={() => setTab("sent")}
          className={`min-h-11 rounded-[var(--radius-tags)] border px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)] ${tab === "sent" ? "border-[color:var(--color-iris-blue)] bg-[color:var(--color-lavender-wash)] text-[color:var(--color-ink)]" : "border-[color:var(--color-mist-gray)] text-[color:var(--color-ink)]"}`}
        >
          Sent{tab === "sent" && data ? ` (${requests.length})` : ""}
        </button>
      </div>

      <div className="flex items-center justify-between">
        <label htmlFor="requests-sort" className="sr-only">
          Sort
        </label>
        <select
          id="requests-sort"
          value={sort}
          onChange={(event) => setSort(event.target.value as SortMode)}
          className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
        >
          {(Object.entries(SORT_LABELS) as [SortMode, string][]).map(([value, label]) => (
            <option key={value} value={value}>
              Sort: {label}
            </option>
          ))}
        </select>

        {tab === "received" && expiringCount > 0 && (
          <button
            type="button"
            onClick={() => void declineAllExpiring()}
            className="min-h-11 text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)] underline"
          >
            Decline all expiring
          </button>
        )}
      </div>

      {tab === "received" && data?.throttle?.enabled && data.throttle.queued_count > 0 && (
        <div
          className="flex items-center justify-between rounded-[var(--radius-cards)] p-[var(--spacing-16)]"
          style={{ backgroundColor: "var(--color-warning-tint)" }}
        >
          <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
            {data.throttle.queued_count} requests are queued for tomorrow (your daily cap is{" "}
            {data.throttle.daily_cap}).
          </p>
          <Link
            href="/settings/account"
            className="text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)] underline"
          >
            Change
          </Link>
        </div>
      )}

      {isError && (
        <div
          role="alert"
          className="rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]"
        >
          <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
            Couldn&apos;t load requests.
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
              className="h-40 w-full animate-pulse rounded-[var(--radius-cards)] bg-[color:var(--color-mist-gray)]"
            />
          ))}
        </div>
      )}

      {!isError && !isLoading && requests.length === 0 && (
        <div className="rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-24)] text-center">
          <p className="text-[length:var(--text-body)] text-[color:var(--color-ink)]">
            {tab === "received"
              ? "No requests yet — going available is the fastest way to get them."
              : "You haven't sent any requests yet."}
          </p>
          {tab === "received" && (
            <Link
              href="/discover"
              className="mt-[var(--spacing-16)] inline-block min-h-11 rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-8 py-3 text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)]"
            >
              Browse discover
            </Link>
          )}
        </div>
      )}

      {!isError && !isLoading && requests.length > 0 && (
        <div className="flex flex-col gap-[var(--spacing-16)]">
          {requests.map((request) => {
            const noteExpanded = expandedNoteIds.has(request.id);
            const intentLabel = request.intent
              ? (taxonomy.find((entry) => entry.type === request.intent?.type)?.label ??
                humanize(request.intent.type))
              : null;
            const counterpartyId = tab === "received" ? request.sender_id : request.recipient_id;
            return (
              <div
                key={request.id}
                className="flex flex-col gap-[var(--spacing-8)] rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[length:var(--text-body-sm)] font-medium text-[color:var(--color-ink)]">
                      {request.counterparty?.full_name ?? "Member"}
                      {(request.counterparty?.verification_level ?? 0) >= 2 && (
                        <span className="ml-1 text-[color:var(--color-iris-blue)]">✔</span>
                      )}
                    </p>
                    {request.counterparty?.headline && (
                      <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                        {request.counterparty.headline}
                      </p>
                    )}
                    <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                      {request.counterparty?.distance_bucket ?? "Distance unknown"}
                      {intentLabel ? ` · 🎯 ${intentLabel}` : ""}
                    </p>
                  </div>
                  {request.match_score !== null && (
                    <span className="numeric text-[length:var(--text-body-sm)] font-semibold text-[color:var(--color-ink)]">
                      ✦ {request.match_score}
                    </span>
                  )}
                </div>

                {request.note && (
                  <div className="border-t border-[color:var(--color-mist-gray)] pt-[var(--spacing-8)]">
                    <p
                      className={
                        noteExpanded
                          ? "text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
                          : "line-clamp-2 text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
                      }
                    >
                      {request.note}
                    </p>
                    <button
                      type="button"
                      onClick={() => toggleNote(request.id)}
                      className="min-h-11 text-[length:var(--text-caption)] text-[color:var(--color-iris-blue)] underline"
                    >
                      {noteExpanded ? "less" : "more"} ▾
                    </button>
                  </div>
                )}

                {request.match_reasons && request.match_reasons.length > 0 && (
                  <div className="flex flex-wrap gap-[var(--spacing-8)]">
                    {request.match_reasons.map((reason) => (
                      <span
                        key={reason}
                        className="rounded-[var(--radius-tags)] bg-[color:var(--color-mint-wash)] px-3 py-1 text-[length:var(--text-caption)] text-[color:var(--color-ink)]"
                      >
                        ✓ {reason}
                      </span>
                    ))}
                  </div>
                )}

                <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                  {request.status === "pending"
                    ? `Expires in ${Math.max(0, daysUntil(request.expires_at))} days`
                    : request.status === "accepted"
                      ? "Accepted"
                      : request.status === "expired"
                        ? "Expired"
                        : request.status === "cancelled"
                          ? "Withdrawn"
                          : "Pending"}
                </p>

                <div className="flex items-center gap-[var(--spacing-8)]">
                  {tab === "received" && request.status === "pending" && (
                    <>
                      <button
                        type="button"
                        onClick={() => void acceptRequest(request)}
                        className="min-h-11 flex-1 rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)]"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => void declineRequest(request.id)}
                        className="min-h-11 flex-1 rounded-[var(--radius-buttons)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
                      >
                        Decline
                      </button>
                    </>
                  )}
                  {tab === "sent" && request.status === "pending" && (
                    <button
                      type="button"
                      onClick={() => void withdrawRequest(request.id)}
                      className="min-h-11 flex-1 rounded-[var(--radius-buttons)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
                    >
                      Withdraw
                    </button>
                  )}
                  {request.counterparty && (
                    <Link
                      href={`/profile/${counterpartyId}`}
                      className="min-h-11 content-center text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)] underline"
                    >
                      Profile
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
