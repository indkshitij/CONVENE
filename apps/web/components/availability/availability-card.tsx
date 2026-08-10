"use client";

import { availability as availabilityTokens } from "@convene/tokens";
import { useEffect, useRef, useState } from "react";
import {
  useAvailabilityMe,
  useEndAvailabilityMutation,
  useExtendAvailabilityMutation,
  useGoAvailableMutation,
} from "@/hooks/use-availability";
import { computeCountdown, formatCountdown } from "@/lib/availability/countdown";

const TICK_INTERVAL_MS = 1000;
const DEFAULT_DURATION_MINUTES = 30;

// design.md §14.7's availability control card + §15.7's micro-interactions.
// NFR-ACC-008: availability is always icon + colour + label, never colour
// alone — every branch below renders availabilityTokens.availableNow's
// icon and label text alongside its color, never the color in isolation.
export function AvailabilityCard() {
  const { data, isLoading } = useAvailabilityMe();
  const goAvailable = useGoAvailableMutation();
  const extend = useExtendAvailabilityMutation();
  const end = useEndAvailabilityMutation();

  const session = data?.current_session ?? null;
  const isActive = session?.state === "available_now" && !!session.expires_at;

  // Forces a re-render every second so computeCountdown recomputes fresh
  // against the server's own expires_at — no state here ever stores a
  // "target time," only a tick counter to trigger recomputation.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => forceTick((value) => value + 1), TICK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isActive]);

  const countdown = isActive && session.expires_at ? computeCountdown(session.expires_at) : null;

  // design.md §15.10: "live regions for ... availability changes;
  // countdowns not announced continuously." The ticking number itself is
  // aria-live="off" (below); this ref+effect fires exactly one polite
  // announcement when the T-5min threshold is first crossed, and resets
  // only once the session is no longer in that window (extended past it,
  // ended, or a new session started) so a later approach can announce
  // again.
  const hasAnnouncedExpiringSoonRef = useRef(false);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (countdown?.isExpiringSoon && !hasAnnouncedExpiringSoonRef.current) {
      hasAnnouncedExpiringSoonRef.current = true;
      setAnnouncement("Your availability ends in 5 minutes.");
    } else if (!countdown?.isExpiringSoon) {
      hasAnnouncedExpiringSoonRef.current = false;
    }
  }, [countdown?.isExpiringSoon]);

  if (isLoading) {
    return (
      <div className="rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-24)]">
        <div className="h-6 w-32 animate-pulse rounded-[var(--radius-tags)] bg-[color:var(--color-mist-gray)]" />
      </div>
    );
  }

  if (!isActive || !session || !countdown) {
    return (
      <div className="rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-24)]">
        <p className="text-[length:var(--text-body)] text-[color:var(--color-ink)]">
          Go available to see who&apos;s around
        </p>
        <button
          type="button"
          onClick={() => goAvailable.mutate({ durationMinutes: DEFAULT_DURATION_MINUTES })}
          disabled={goAvailable.isPending}
          className="mt-[var(--spacing-16)] min-h-11 w-full rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-8 py-3 text-[length:var(--text-body)] text-[color:var(--color-paper-white)] disabled:opacity-50"
        >
          {goAvailable.isPending
            ? "Going available…"
            : `Go available for ${DEFAULT_DURATION_MINUTES} min`}
        </button>
      </div>
    );
  }

  const state = availabilityTokens.availableNow;

  return (
    <div className="rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-24)]">
      {/* One polite announcement only — never the ticking number itself. */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {countdown.isExpiringSoon && (
        <div
          role="alert"
          className="mb-[var(--spacing-16)] rounded-[var(--radius-inputs)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)]"
          style={{
            backgroundColor: "var(--color-warning-tint)",
            color: "var(--availability-busy)",
          }}
        >
          Ending soon — extend now to keep the conversation going.
        </div>
      )}

      <div className="flex items-center gap-[var(--spacing-16)]">
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center">
          <span
            aria-hidden="true"
            className="availability-pulse-ring absolute inset-0 rounded-full"
            style={{ backgroundColor: "var(--availability-available-now)" }}
          />
          <span
            aria-hidden="true"
            className="relative text-[length:var(--text-body-lg)]"
            style={{ color: "var(--availability-available-now)" }}
          >
            {state.icon}
          </span>
        </span>

        <div className="flex-1">
          <p className="text-[length:var(--text-body)] font-medium text-[color:var(--color-ink)]">
            {state.label}
          </p>
          {session.note && (
            <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
              {session.note}
            </p>
          )}
        </div>

        <span
          aria-live="off"
          className="numeric text-[length:var(--text-heading-sm)] font-semibold text-[color:var(--color-ink)]"
        >
          {formatCountdown(countdown.remainingMs)}
        </span>
      </div>

      <div className="mt-[var(--spacing-16)] flex gap-[var(--spacing-8)]">
        <button
          type="button"
          onClick={() => extend.mutate({ sessionId: session.id, additionalMinutes: 15 })}
          disabled={extend.isPending || session.extensions_remaining === 0}
          className="min-h-11 flex-1 rounded-[var(--radius-buttons)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)] disabled:opacity-50"
        >
          +15 min
        </button>
        <button
          type="button"
          onClick={() => end.mutate(session.id)}
          disabled={end.isPending}
          className="min-h-11 flex-1 rounded-[var(--radius-buttons)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)] disabled:opacity-50"
        >
          End early
        </button>
      </div>
    </div>
  );
}
