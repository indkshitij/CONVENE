"use client";

import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { pushToast } from "@/stores/ui";
import type { HydratedDiscoveryResponse } from "@/lib/api/client";

const UNDO_WINDOW_MS = 5000; // design.md §15.7: "undoable via a 5s toast."

// There is no "unskip" endpoint (grepped matches.controller.ts — POST
// .../skip only inserts a permanent match_suppressions row, nothing
// reverses it). A real, honest undo therefore can't call skip-then-unskip
// — it has to delay the actual API call until the undo window closes,
// and cancel that pending call if the user clicks Undo in time. The card
// disappears immediately either way (§15.7's "Card slides out... Clear"),
// but the server-side suppression only actually happens after 5s.
export function useSkipCandidate(queryKey: readonly unknown[]) {
  const queryClient = useQueryClient();
  const pendingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const hide = useCallback(
    (candidateId: string) => {
      queryClient.setQueryData<InfiniteData<HydratedDiscoveryResponse>>(queryKey, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            data: page.data.filter((match) => match.candidate_id !== candidateId),
          })),
        };
      });
    },
    [queryClient, queryKey],
  );

  return useCallback(
    (candidateId: string) => {
      const snapshot = queryClient.getQueryData<InfiniteData<HydratedDiscoveryResponse>>(queryKey);
      hide(candidateId);

      const timer = setTimeout(() => {
        pendingTimers.current.delete(candidateId);
        void fetch(`/api/matches/${candidateId}/skip`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
      }, UNDO_WINDOW_MS);
      pendingTimers.current.set(candidateId, timer);

      pushToast({
        variant: "info",
        message: "Not interested",
        durationMs: UNDO_WINDOW_MS,
        action: {
          label: "Undo",
          onClick: () => {
            const pending = pendingTimers.current.get(candidateId);
            if (pending) {
              clearTimeout(pending);
              pendingTimers.current.delete(candidateId);
            }
            if (snapshot) queryClient.setQueryData(queryKey, snapshot);
          },
        },
      });
    },
    [queryClient, queryKey, hide],
  );
}
