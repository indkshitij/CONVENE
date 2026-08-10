"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/api/query-keys";
import type { AvailabilityMeResponse, SessionResponse } from "@/lib/api/client";

// PRD §18.3's own line: "Optimistic mutations are used for exactly four
// operations — sending a message, reacting, toggling availability, and
// skipping a match — each with a rollback in onError and a reconcile in
// onSettled." This is the first of the four to actually get built (no
// other feature has shipped yet) and establishes the pattern the other
// three will follow.
const DEFAULT_GO_AVAILABLE_MINUTES = 30;

async function fetchAvailabilityMe(): Promise<AvailabilityMeResponse> {
  const response = await fetch("/api/availability/me");
  if (!response.ok) throw new Error("Failed to load availability");
  return (await response.json()) as AvailabilityMeResponse;
}

export function useAvailabilityMe() {
  return useQuery({ queryKey: qk.availability.me(), queryFn: fetchAvailabilityMe });
}

function snapshotAndOptimisticallySet(queryClient: QueryClient, next: SessionResponse | null) {
  const previous = queryClient.getQueryData<AvailabilityMeResponse>(qk.availability.me());
  queryClient.setQueryData<AvailabilityMeResponse>(qk.availability.me(), { current_session: next });
  return { previous };
}

function rollback(queryClient: QueryClient, previous: AvailabilityMeResponse | undefined) {
  if (previous) queryClient.setQueryData(qk.availability.me(), previous);
}

// design.md §15.7: "Going available: button morphs into the countdown
// card ... immediately." The real expires_at can only be known once the
// server responds (it derives from server time, not the client's
// duration_minutes math), so the optimistic session below is explicitly
// provisional — onSuccess immediately overwrites it with the server's
// own authoritative session, and the countdown itself (availability-card.tsx)
// always reads expires_at from whatever is currently in the Query cache,
// never from a value it computed itself at mount.
export function useGoAvailableMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { durationMinutes?: number; note?: string }) => {
      const response = await fetch("/api/availability/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: "available_now",
          duration_minutes: input.durationMinutes ?? DEFAULT_GO_AVAILABLE_MINUTES,
          note: input.note,
          source: "home_card",
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error: { message: string } };
        throw new Error(body.error.message || "Something went wrong. Please try again.");
      }
      return (await response.json()) as { session: SessionResponse };
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: qk.availability.me() });
      const durationMinutes = input.durationMinutes ?? DEFAULT_GO_AVAILABLE_MINUTES;
      const now = Date.now();
      const optimisticSession: SessionResponse = {
        id: "optimistic",
        state: "available_now",
        started_at: new Date(now).toISOString(),
        expires_at: new Date(now + durationMinutes * 60_000).toISOString(),
        duration_minutes: durationMinutes,
        extensions_used: 0,
        extensions_remaining: 3,
        note: input.note ?? null,
        session_intents: [],
      };
      return snapshotAndOptimisticallySet(queryClient, optimisticSession);
    },
    onSuccess: (result) => {
      queryClient.setQueryData<AvailabilityMeResponse>(qk.availability.me(), {
        current_session: result.session,
      });
    },
    onError: (_error, _input, context) => rollback(queryClient, context?.previous),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: qk.availability.me() }),
  });
}

export function useExtendAvailabilityMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sessionId,
      additionalMinutes,
    }: {
      sessionId: string;
      additionalMinutes: 15 | 30 | 60;
    }) => {
      const response = await fetch(`/api/availability/sessions/${sessionId}/extend`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ additional_minutes: additionalMinutes }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error: { message: string } };
        throw new Error(body.error.message || "Something went wrong. Please try again.");
      }
      return (await response.json()) as SessionResponse;
    },
    onMutate: async ({ additionalMinutes }) => {
      await queryClient.cancelQueries({ queryKey: qk.availability.me() });
      const previousData = queryClient.getQueryData<AvailabilityMeResponse>(qk.availability.me());
      const current = previousData?.current_session;
      if (current?.expires_at) {
        const extended: SessionResponse = {
          ...current,
          expires_at: new Date(
            new Date(current.expires_at).getTime() + additionalMinutes * 60_000,
          ).toISOString(),
          extensions_used: current.extensions_used + 1,
          extensions_remaining: Math.max(0, current.extensions_remaining - 1),
        };
        queryClient.setQueryData<AvailabilityMeResponse>(qk.availability.me(), {
          current_session: extended,
        });
      }
      return { previous: previousData };
    },
    onSuccess: (session) => {
      queryClient.setQueryData<AvailabilityMeResponse>(qk.availability.me(), {
        current_session: session,
      });
    },
    onError: (_error, _input, context) => rollback(queryClient, context?.previous),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: qk.availability.me() }),
  });
}

export function useEndAvailabilityMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await fetch(`/api/availability/sessions/${sessionId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json()) as { error: { message: string } };
        throw new Error(body.error.message || "Something went wrong. Please try again.");
      }
      return (await response.json()) as {
        matches_viewed: number;
        requests_sent: number;
        conversations_started: number;
        duration_actual_minutes: number;
      };
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: qk.availability.me() });
      return snapshotAndOptimisticallySet(queryClient, null);
    },
    onError: (_error, _sessionId, context) => rollback(queryClient, context?.previous),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: qk.availability.me() }),
  });
}
