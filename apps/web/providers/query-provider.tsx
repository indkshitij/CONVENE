"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "@/lib/api/client";
import { pushToast } from "@/stores/ui";

const THIRTY_SECONDS_MS = 30 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;

// PRD §18.3: "retry 1 with exponential backoff, retry disabled for
// 4xx." A non-ApiError (network failure, JSON parse error) still gets
// the one retry — only a real, server-issued 4xx response is treated as
// "retrying won't help."
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

// §18.3: "a global onError mapping the standard envelope to a toast or
// an inline error." A query/mutation opts out of the automatic toast via
// `meta: { suppressErrorToast: true }` when it wants to render the error
// inline instead (e.g. a form's own field-level error) — the two aren't
// mutually exclusive paths in code, they're the same error surfaced two
// different ways depending on what the call site asked for.
export function defaultOnError(error: unknown, meta: Record<string, unknown> | undefined): void {
  if (meta?.suppressErrorToast) return;
  const message =
    error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
  pushToast({ variant: "error", message });
}

export function createQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: THIRTY_SECONDS_MS,
        gcTime: TEN_MINUTES_MS,
        retry: shouldRetry,
      },
      mutations: {
        retry: shouldRetry,
      },
    },
    queryCache: new QueryCache({
      onError: (error, query) => defaultOnError(error, query.meta),
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => defaultOnError(error, mutation.meta),
    }),
  });

  // §18.3: "staleTime 30s (5min taxonomies, 0 messages)" — per-entity
  // overrides registered against the same key prefixes query-keys.ts's
  // factory produces, via TanStack's own prefix-matching setQueryDefaults
  // rather than a per-call staleTime that could drift from the factory.
  queryClient.setQueryDefaults(["taxonomies"], { staleTime: FIVE_MINUTES_MS });
  queryClient.setQueryDefaults(["conversation", "messages"], { staleTime: 0 });
  // Availability is near-real-time (a ticking countdown, expiring-soon
  // and end-of-session transitions) — always refetched rather than
  // trusted from an earlier mount, same treatment as messages.
  queryClient.setQueryDefaults(["availability"], { staleTime: 0 });

  return queryClient;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // One QueryClient per component instance (not module-level), so a
  // server-rendered request never leaks cached data into a different
  // user's session — the standard Next.js App Router + TanStack Query
  // pattern.
  const [queryClient] = useState(() => createQueryClient());
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
