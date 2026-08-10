"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { qk } from "@/lib/api/query-keys";
import type { HydratedDiscoveryResponse, HydratedMatchCard } from "@/lib/api/client";
import { discoveryEmptyStateCopy } from "@/lib/discovery/empty-state-copy";
import { tierLabel } from "@/lib/discovery/tier-labels";
import { shareProfile } from "@/lib/discovery/share-profile";
import { useSkipCandidate } from "@/hooks/use-skip-candidate";
import { MatchCard } from "./match-card";
import { ReportModal } from "./report-modal";

export type DiscoverSurface = "available_now" | "nearby" | "global";

const TABS: { value: DiscoverSurface; label: string }[] = [
  { value: "available_now", label: "Available now" },
  { value: "nearby", label: "Nearby" },
  { value: "global", label: "Global" },
];

function pathFor(surface: DiscoverSurface, cursor: string | null): string {
  const base =
    surface === "available_now" ? "/api/discover/available-now" : `/api/discover?tab=${surface}`;
  if (!cursor) return base;
  return `${base}${base.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`;
}

async function fetchPage(
  surface: DiscoverSurface,
  cursor: string | null,
): Promise<HydratedDiscoveryResponse> {
  const response = await fetch(pathFor(surface, cursor));
  if (!response.ok) throw new Error("Failed to load the discover feed");
  return (await response.json()) as HydratedDiscoveryResponse;
}

type Row =
  | { kind: "header"; label: string; count: number }
  | { kind: "card"; match: HydratedMatchCard }
  | { kind: "loader" };

function buildRows(matches: HydratedMatchCard[]): Row[] {
  const rows: Row[] = [];
  let currentTier: number | null = null;
  let headerRowIndex = -1;
  for (const match of matches) {
    if (match.location_tier !== currentTier) {
      currentTier = match.location_tier;
      rows.push({ kind: "header", label: tierLabel(currentTier), count: 0 });
      headerRowIndex = rows.length - 1;
    }
    rows.push({ kind: "card", match });
    const header = rows[headerRowIndex];
    if (header?.kind === "header") header.count += 1;
  }
  return rows;
}

export function DiscoverFeed({
  initialSurface,
  initialData,
}: {
  initialSurface: DiscoverSurface;
  initialData: HydratedDiscoveryResponse;
}) {
  const [surface, setSurface] = useState<DiscoverSurface>(initialSurface);
  const [reportTargetId, setReportTargetId] = useState<string | null>(null);
  const queryKey = qk.feed.discover({ surface });

  // Only the tab the server actually rendered gets to skip its own first
  // loading state — switching tabs client-side always refetches
  // (design.md's own Loading row: "3 card skeletons"). exactOptionalPropertyTypes
  // rejects `initialData: undefined`, so the key is omitted entirely
  // rather than set to undefined for every other tab.
  const { data, isError, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
    useInfiniteQuery({
      queryKey,
      queryFn: ({ pageParam }) => fetchPage(surface, pageParam),
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage) => lastPage.meta.next_cursor,
      ...(surface === initialSurface
        ? { initialData: { pages: [initialData], pageParams: [null] } }
        : {}),
    });

  const skip = useSkipCandidate(queryKey);

  const onSkip = useCallback((candidateId: string) => skip(candidateId), [skip]);
  const onShare = useCallback(
    (candidateId: string) => {
      const match = data?.pages
        .flatMap((page) => page.data)
        .find((entry) => entry.candidate_id === candidateId);
      void shareProfile(candidateId, match?.profile?.full_name ?? null);
    },
    [data],
  );
  const onReport = useCallback((candidateId: string) => setReportTargetId(candidateId), []);

  const matches = useMemo(() => data?.pages.flatMap((page) => page.data) ?? [], [data]);
  const rows = useMemo<Row[]>(() => {
    const base = buildRows(matches);
    if (hasNextPage) base.push({ kind: "loader" });
    return base;
  }, [matches, hasNextPage]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) =>
      rows[index]?.kind === "header" ? 40 : rows[index]?.kind === "loader" ? 60 : 240,
    overscan: 5,
  });

  const loaderRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = loaderRef.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { root: parentRef.current, rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [rows.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  function selectSurface(next: DiscoverSurface) {
    setSurface(next);
    window.history.replaceState(null, "", `/discover?tab=${next}`);
  }

  const emptyStateReason = data?.pages[0]?.empty_state ?? null;

  return (
    <div className="flex flex-col gap-[var(--spacing-16)] px-[var(--spacing-24)] py-[var(--spacing-24)]">
      <h1 className="text-[length:var(--text-heading-sm)] font-[family-name:var(--font-aeonik)] text-[color:var(--color-ink)]">
        Discover
      </h1>

      <div role="tablist" aria-label="Discovery surface" className="flex gap-[var(--spacing-8)]">
        {TABS.map((tabOption) => (
          <button
            key={tabOption.value}
            role="tab"
            aria-selected={surface === tabOption.value}
            onClick={() => selectSurface(tabOption.value)}
            className={`min-h-11 rounded-[var(--radius-tags)] border px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)] ${surface === tabOption.value ? "border-[color:var(--color-iris-blue)] bg-[color:var(--color-lavender-wash)] text-[color:var(--color-ink)]" : "border-[color:var(--color-mist-gray)] text-[color:var(--color-ink)]"}`}
          >
            {tabOption.label}
          </button>
        ))}
      </div>

      {isError && (
        <div
          role="alert"
          className="rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]"
        >
          <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
            Couldn&apos;t load the discover feed.
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
              className="h-56 w-full animate-pulse rounded-[var(--radius-cards)] bg-[color:var(--color-mist-gray)]"
            />
          ))}
        </div>
      )}

      {!isError && !isLoading && matches.length === 0 && (
        <div className="rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-24)] text-center">
          <p className="text-[length:var(--text-body)] text-[color:var(--color-ink)]">
            {discoveryEmptyStateCopy(emptyStateReason ?? "no_supply", "discover_feed")}
          </p>
          {surface !== "global" && emptyStateReason === "no_supply" && (
            <button
              type="button"
              onClick={() => selectSurface("global")}
              className="mt-[var(--spacing-16)] min-h-11 rounded-[var(--radius-buttons)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
            >
              Show matches across the country
            </button>
          )}
        </div>
      )}

      {!isError && !isLoading && matches.length > 0 && (
        <div ref={parentRef} className="max-h-[calc(100vh-220px)] overflow-y-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {row.kind === "header" && (
                    <h2 className="px-[var(--spacing-8)] py-[var(--spacing-8)] text-[length:var(--text-caption)] font-medium tracking-wide text-[color:var(--color-graphite)] uppercase">
                      {row.label} · {row.count}
                    </h2>
                  )}
                  {row.kind === "card" && (
                    <div className="pb-[var(--spacing-16)]">
                      <MatchCard
                        match={row.match}
                        onSkip={onSkip}
                        onShare={onShare}
                        onReport={onReport}
                      />
                    </div>
                  )}
                  {row.kind === "loader" && (
                    <div ref={loaderRef} className="flex h-14 items-center justify-center">
                      <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
                        Loading more…
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {reportTargetId && (
        <ReportModal candidateId={reportTargetId} onClose={() => setReportTargetId(null)} />
      )}
    </div>
  );
}
