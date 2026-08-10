"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { CreateSessionResult, IntentResponse, IntentTaxonomyEntry } from "@/lib/api/client";

// design.md §14.6 step 6: "duration chips, optional note, session-intent
// selector, and the primary action `Go available for 30 min`. Secondary:
// `Schedule a time instead`. Tertiary: `Not now`." BR-AVAIL-01's base
// duration set (15/30/60/120) — Premium's custom-up-to-240 picker is
// deferred to P21.1's dedicated availability control, same "don't branch
// UI on plan mid-onboarding" reasoning as step 5's radius control.
const DURATION_OPTIONS = [15, 30, 60, 120] as const;
const MAX_SESSION_INTENTS = 5;

interface ApiErrorBody {
  error: { message: string };
}

export function GoAvailableForm({
  activeIntents,
  taxonomy,
}: {
  activeIntents: IntentResponse[];
  taxonomy: IntentTaxonomyEntry[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [duration, setDuration] = useState<(typeof DURATION_OPTIONS)[number]>(30);
  const [note, setNote] = useState("");
  const [selectedIntentIds, setSelectedIntentIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateSessionResult | null>(null);
  const [endingSession, setEndingSession] = useState(false);

  const labelFor = (type: string) => taxonomy.find((entry) => entry.type === type)?.label ?? type;

  function toggleIntent(id: string) {
    setSelectedIntentIds((current) => {
      if (current.includes(id)) return current.filter((existing) => existing !== id);
      if (current.length >= MAX_SESSION_INTENTS) return current;
      return [...current, id];
    });
  }

  async function goAvailable() {
    setServerError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/availability/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: "available_now",
          duration_minutes: duration,
          note: note.trim().length > 0 ? note.trim() : undefined,
          session_intent_ids: selectedIntentIds.length > 0 ? selectedIntentIds : undefined,
          source: "onboarding_step_6",
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as ApiErrorBody;
        setServerError(body.error.message || "Something went wrong. Please try again.");
        return;
      }
      setResult((await response.json()) as CreateSessionResult);
    } catch {
      setServerError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function endAndScheduleInstead() {
    if (!result) return;
    setEndingSession(true);
    try {
      await fetch(`/api/availability/sessions/${result.session.id}`, { method: "DELETE" });
    } finally {
      router.push("/home");
    }
  }

  // No scheduling UI exists anywhere in this codebase yet (P10.3's own
  // scope, not built by any phase through P20.3) — rather than build a
  // recurring-window picker inside a 15s onboarding step, this button is
  // present (design.md's literal 3-action requirement) but honestly
  // degrades to "Not now" with an explanatory note, same "flag the gap,
  // don't fabricate the feature" precedent as the Apple OAuth and
  // LinkedIn-import omissions elsewhere in this session.
  const [scheduleNoteShown, setScheduleNoteShown] = useState(false);

  if (result) {
    const zeroSupply =
      result.match_preview !== null && result.match_preview.available_now_count === 0;
    return (
      <div className="flex flex-col gap-[var(--spacing-24)]">
        {zeroSupply ? (
          <div className="rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]">
            <p className="text-[length:var(--text-body)] text-[color:var(--color-ink)]">
              You&apos;re available now. Only a few people are nearby right now, so it may take a
              bit for a match to show up.
            </p>
            <button
              type="button"
              onClick={() => void endAndScheduleInstead()}
              disabled={endingSession}
              className="mt-[var(--spacing-16)] min-h-11 w-full rounded-[var(--radius-buttons)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body)] text-[color:var(--color-ink)] disabled:opacity-50"
            >
              {endingSession ? "Ending…" : "End this session instead"}
            </button>
          </div>
        ) : (
          <p className="text-[length:var(--text-body)] text-[color:var(--color-ink)]">
            You&apos;re available now — {result.match_preview?.available_now_count ?? 0} people are
            available nearby right now.
          </p>
        )}
        <button
          type="button"
          onClick={() => router.push("/home")}
          className="min-h-11 w-full rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-8 py-3 text-[length:var(--text-body)] text-[color:var(--color-paper-white)]"
        >
          Continue to Convene
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-24)]">
      <fieldset>
        <legend className="mb-[var(--spacing-8)] text-[length:var(--text-body-sm)] font-medium text-[color:var(--color-ink)]">
          How long?
        </legend>
        <div className="flex flex-wrap gap-[var(--spacing-8)]">
          {DURATION_OPTIONS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              aria-pressed={duration === minutes}
              onClick={() => setDuration(minutes)}
              className={`min-h-11 rounded-[var(--radius-tags)] border px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)] ${duration === minutes ? "border-[color:var(--color-iris-blue)] bg-[color:var(--color-lavender-wash)] text-[color:var(--color-ink)]" : "border-[color:var(--color-mist-gray)] text-[color:var(--color-ink)]"}`}
            >
              {minutes} min
            </button>
          ))}
          {/* PRD §13 F11 trigger 5: "custom duration > 120 min -> paywall:
              session length." Free-plan duration is a fixed discrete set
              (BR-AVAIL-01) — there's no way to type an arbitrary minute
              value here, so the paywall fires the moment this option is
              tapped rather than after a failed submit. */}
          <Link
            href={`/premium?reason=session_duration&return_to=${encodeURIComponent(pathname)}`}
            className="min-h-11 rounded-[var(--radius-tags)] border border-dashed border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]"
          >
            🔒 Custom
          </Link>
        </div>
      </fieldset>

      <div>
        <label
          htmlFor="availability-note"
          className="mb-[var(--spacing-8)] block text-[length:var(--text-body-sm)] font-medium text-[color:var(--color-ink)]"
        >
          Note (optional)
        </label>
        <input
          id="availability-note"
          value={note}
          maxLength={120}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. Happy to talk NLP or careers"
          className="min-h-11 w-full rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body)] text-[color:var(--color-ink)]"
        />
      </div>

      {activeIntents.length > 0 && (
        <fieldset>
          <legend className="mb-[var(--spacing-8)] text-[length:var(--text-body-sm)] font-medium text-[color:var(--color-ink)]">
            Which intents apply right now? (optional — leave blank for all)
          </legend>
          <div className="flex flex-col gap-[var(--spacing-8)]">
            {activeIntents.map((intent) => (
              <label key={intent.id} className="flex min-h-11 items-center gap-[var(--spacing-8)]">
                <input
                  type="checkbox"
                  checked={selectedIntentIds.includes(intent.id)}
                  onChange={() => toggleIntent(intent.id)}
                />
                <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
                  {labelFor(intent.type)}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {serverError && (
        <p
          role="alert"
          className="text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]"
        >
          {serverError}
        </p>
      )}

      <button
        type="button"
        onClick={() => void goAvailable()}
        disabled={isSubmitting}
        className="min-h-11 w-full rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-8 py-3 text-[length:var(--text-body)] text-[color:var(--color-paper-white)] disabled:opacity-50"
      >
        {isSubmitting ? "Going available…" : `Go available for ${duration} min`}
      </button>

      <button
        type="button"
        onClick={() => setScheduleNoteShown(true)}
        className="min-h-11 w-full rounded-[var(--radius-buttons)] border border-[color:var(--color-mist-gray)] px-8 py-3 text-[length:var(--text-body)] text-[color:var(--color-ink)]"
      >
        Schedule a time instead
      </button>
      {scheduleNoteShown && (
        <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
          Scheduling isn&apos;t available yet — you can always go available later from Home.{" "}
          <button type="button" onClick={() => router.push("/home")} className="underline">
            Continue to Convene
          </button>
        </p>
      )}

      <button
        type="button"
        onClick={() => router.push("/home")}
        className="min-h-11 w-full text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)] underline"
      >
        Not now
      </button>
    </div>
  );
}
