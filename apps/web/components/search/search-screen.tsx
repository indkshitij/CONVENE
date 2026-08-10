"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { parseAsArrayOf, parseAsBoolean, parseAsInteger, parseAsString, useQueryState } from "nuqs";
import { useState, useSyncExternalStore } from "react";
import type {
  EntitlementsResult,
  Industry,
  IntentTaxonomyEntry,
  SearchUsersResult,
} from "@/lib/api/client";

const RECENT_SEARCHES_KEY = "convene:recent-searches";
const RECENT_SEARCHES_MAX = 5;
const recentSearchesListeners = new Set<() => void>();

// design.md §14.16: filters split into free vs Premium-locked — no
// backend field marks a param as "locked", so this mirrors the exact
// split apps/api's SearchService enforces (search.service.ts's own
// PREMIUM_ONLY comment) rather than guessing.
const PREMIUM_FILTER_LABELS: Record<string, string> = {
  skills: "Filter by skills",
  min_exp: "Filter by years of experience",
  max_exp: "Filter by years of experience",
  verified_only: "Filter by verified-only",
};

// useSyncExternalStore requires getSnapshot to return a stable reference
// when the underlying value hasn't changed (otherwise every render
// re-parses a fresh array, React sees "changed" every time, and re-
// renders in an infinite loop) — this cache is what makes that hold.
let recentSearchesCache: { raw: string | null; value: string[] } = {
  raw: undefined as unknown as string | null,
  value: [],
};

function readRecentSearches(): string[] {
  if (typeof window === "undefined") return EMPTY_RECENT_SEARCHES;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
  } catch {
    return EMPTY_RECENT_SEARCHES;
  }
  if (raw === recentSearchesCache.raw) return recentSearchesCache.value;
  let value: string[];
  try {
    value = raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    value = [];
  }
  recentSearchesCache = { raw, value };
  return value;
}

function pushRecentSearch(query: string): void {
  if (typeof window === "undefined" || !query.trim()) return;
  const next = [query, ...readRecentSearches().filter((entry) => entry !== query)].slice(
    0,
    RECENT_SEARCHES_MAX,
  );
  window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  for (const listener of recentSearchesListeners) listener();
}

function subscribeToRecentSearches(callback: () => void): () => void {
  recentSearchesListeners.add(callback);
  return () => recentSearchesListeners.delete(callback);
}

const EMPTY_RECENT_SEARCHES: string[] = [];

async function fetchEntitlements(): Promise<EntitlementsResult> {
  const response = await fetch("/api/entitlements");
  if (!response.ok) throw new Error("Failed to load entitlements");
  return (await response.json()) as EntitlementsResult;
}

async function fetchSearch(params: URLSearchParams): Promise<SearchUsersResult> {
  const response = await fetch(`/api/search/users?${params.toString()}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string; details?: { filter?: string } };
    } | null;
    const error = new Error(body?.error?.message ?? "Search failed") as Error & {
      code?: string | undefined;
      filter?: string | undefined;
    };
    error.code = body?.error?.code;
    error.filter = body?.error?.details?.filter;
    throw error;
  }
  return (await response.json()) as SearchUsersResult;
}

export function SearchScreen({
  industries,
  taxonomy,
}: {
  industries: Industry[];
  taxonomy: IntentTaxonomyEntry[];
}) {
  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""));
  const [intents, setIntents] = useQueryState(
    "intents",
    parseAsArrayOf(parseAsString).withDefault([]),
  );
  const [industry, setIndustry] = useQueryState("industry", parseAsInteger);
  const [verifiedOnly, setVerifiedOnly] = useQueryState(
    "verified_only",
    parseAsBoolean.withDefault(false),
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [queryInput, setQueryInput] = useState(q);
  const recentSearches = useSyncExternalStore(
    subscribeToRecentSearches,
    readRecentSearches,
    () => EMPTY_RECENT_SEARCHES,
  );

  const { data: entitlements } = useQuery({
    queryKey: ["entitlements"],
    queryFn: fetchEntitlements,
  });
  const isPremium = entitlements?.features.advanced_search_filters ?? false;

  const activeFilterCount = intents.length + (industry ? 1 : 0) + (verifiedOnly ? 1 : 0);

  const searchParams = new URLSearchParams();
  if (q.trim()) searchParams.set("q", q.trim());
  if (intents.length > 0) searchParams.set("intents", intents.join(","));
  if (industry) searchParams.set("industry", String(industry));
  if (verifiedOnly) searchParams.set("verified_only", "true");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["search", "users", searchParams.toString()],
    queryFn: () => fetchSearch(searchParams),
    enabled: q.trim().length >= 2,
  });

  const searchError = error as
    (Error & { code?: string | undefined; filter?: string | undefined }) | null;

  function submitQuery() {
    void setQ(queryInput);
    if (queryInput.trim().length >= 2) pushRecentSearch(queryInput.trim());
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-[var(--spacing-16)] px-[var(--spacing-24)] py-[var(--spacing-24)]">
      <h1 className="sr-only">Search</h1>
      <div className="flex items-center gap-[var(--spacing-8)]">
        <Link
          href="/home"
          aria-label="Back"
          className="min-h-11 min-w-11 content-center text-[length:var(--text-body)] text-[color:var(--color-ink)]"
        >
          ←
        </Link>
        <input
          value={queryInput}
          onChange={(event) => setQueryInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitQuery();
          }}
          placeholder="Search by name, skill, industry…"
          aria-label="Search"
          className="min-h-11 flex-1 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body)] text-[color:var(--color-ink)]"
        />
        {queryInput && (
          <button
            type="button"
            onClick={() => {
              setQueryInput("");
              void setQ("");
            }}
            aria-label="Clear search"
            className="min-h-11 min-w-11 text-[color:var(--color-graphite)]"
          >
            ✕
          </button>
        )}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          className="min-h-11 rounded-[var(--radius-buttons)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
        >
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </button>
        <span
          title="Saved searches aren't available yet"
          className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]"
        >
          ☆ Save search
        </span>
      </div>

      {filtersOpen && (
        <div className="flex flex-col gap-[var(--spacing-16)] rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]">
          <fieldset>
            <legend className="mb-[var(--spacing-8)] text-[length:var(--text-caption)] font-medium uppercase tracking-wide text-[color:var(--color-graphite)]">
              Intent
            </legend>
            <div className="flex flex-wrap gap-[var(--spacing-8)]">
              {taxonomy.map((entry) => {
                const checked = intents.includes(entry.type);
                return (
                  <button
                    key={entry.type}
                    type="button"
                    onClick={() =>
                      void setIntents(
                        checked
                          ? intents.filter((type) => type !== entry.type)
                          : [...intents, entry.type],
                      )
                    }
                    aria-pressed={checked}
                    className={`min-h-11 rounded-[var(--radius-tags)] border px-3 py-1 text-[length:var(--text-caption)] ${checked ? "border-[color:var(--color-iris-blue)] bg-[color:var(--color-lavender-wash)] text-[color:var(--color-ink)]" : "border-[color:var(--color-mist-gray)] text-[color:var(--color-ink)]"}`}
                  >
                    {entry.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label className="flex flex-col gap-1">
            <span className="text-[length:var(--text-caption)] font-medium uppercase tracking-wide text-[color:var(--color-graphite)]">
              Industry
            </span>
            <select
              value={industry ?? ""}
              onChange={(event) =>
                void setIndustry(event.target.value ? Number(event.target.value) : null)
              }
              className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)]"
            >
              <option value="">Any industry</option>
              {industries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>

          {isPremium ? (
            <label className="flex items-center gap-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
              <input
                type="checkbox"
                checked={verifiedOnly}
                onChange={(event) => void setVerifiedOnly(event.target.checked)}
              />
              Verified only
            </label>
          ) : (
            <LockedFilterRow label="Filter by verified-only is a Premium feature" />
          )}
          {!isPremium && <LockedFilterRow label="Filter by skills is a Premium feature" />}
          {!isPremium && (
            <LockedFilterRow label="Filter by years of experience is a Premium feature" />
          )}
        </div>
      )}

      {isError && searchError?.code === "PREMIUM_FILTER_REQUIRED" && (
        <div
          role="alert"
          className="rounded-[var(--radius-cards)] p-[var(--spacing-16)]"
          style={{ backgroundColor: "var(--color-warning-tint)" }}
        >
          <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
            {PREMIUM_FILTER_LABELS[searchError.filter ?? ""] ?? "This filter"} is a Premium feature.
          </p>
          <Link
            href={`/premium?reason=${encodeURIComponent(searchError.filter ?? "search_filter")}`}
            className="text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)] underline"
          >
            Learn more
          </Link>
        </div>
      )}

      {isError && searchError?.code !== "PREMIUM_FILTER_REQUIRED" && (
        <div
          role="alert"
          className="rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]"
        >
          <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
            Something went wrong searching.
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

      {!q.trim() && (
        <div className="flex flex-col gap-[var(--spacing-8)]">
          <h2 className="text-[length:var(--text-caption)] font-medium uppercase tracking-wide text-[color:var(--color-graphite)]">
            Recent searches
          </h2>
          {recentSearches.length === 0 ? (
            <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
              Search by name, skill, industry, or intent.
            </p>
          ) : (
            <div className="flex flex-wrap gap-[var(--spacing-8)]">
              {recentSearches.map((recent) => (
                <button
                  key={recent}
                  type="button"
                  onClick={() => {
                    setQueryInput(recent);
                    void setQ(recent);
                  }}
                  className="min-h-11 rounded-[var(--radius-tags)] border border-[color:var(--color-mist-gray)] px-3 py-1 text-[length:var(--text-caption)] text-[color:var(--color-ink)]"
                >
                  {recent}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {isLoading && q.trim().length >= 2 && (
        <div className="flex flex-col gap-[var(--spacing-8)]">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="h-20 w-full animate-pulse rounded-[var(--radius-cards)] bg-[color:var(--color-mist-gray)]"
            />
          ))}
        </div>
      )}

      {data && (
        <>
          <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
            {data.results.length} {data.results.length === 1 ? "person" : "people"}
            {data.facets.industries.length > 0 &&
              ` · ${data.facets.industries.map((facet) => `${facet.name} (${facet.count})`).join(" · ")}`}
          </p>

          {data.results.length === 0 ? (
            <div className="rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-24)] text-center">
              <p className="text-[length:var(--text-body)] text-[color:var(--color-ink)]">
                No one matches &quot;{q}&quot;.
              </p>
              <p className="mt-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
                Try removing a filter or broadening your search.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-[var(--spacing-8)]">
              {data.results.map((result) => (
                <li key={result.user_id}>
                  <Link
                    href={`/profile/${result.user_id}`}
                    className="flex flex-col gap-1 rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)] no-underline"
                  >
                    <span className="flex items-center gap-1 text-[length:var(--text-body-sm)] font-medium text-[color:var(--color-ink)]">
                      {result.full_name}
                      {result.verification_level >= 2 && <span aria-label="Verified">✔</span>}
                    </span>
                    {result.headline && (
                      <span className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                        {result.headline}
                      </span>
                    )}
                    {result.company_name && (
                      <span className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                        {result.company_name}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function LockedFilterRow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between rounded-[var(--radius-inputs)] bg-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)]">
      <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
        🔒 {label}
      </span>
      <Link
        href="/premium"
        className="text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)] underline"
      >
        Learn
      </Link>
    </div>
  );
}
