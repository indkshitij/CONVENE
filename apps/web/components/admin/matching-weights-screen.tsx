"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { MatchingWeights } from "@/lib/api/client";
import { qk } from "@/lib/api/query-keys";
import { pushToast } from "@/stores/ui";

const WEIGHT_LABELS: Record<keyof MatchingWeights, string> = {
  avail: "Availability",
  intent: "Intent match",
  loc: "Location",
  skill: "Skill overlap",
  industry: "Industry",
  exp: "Experience",
  interest: "Interests",
  mutual: "Mutual connections",
  activity: "Activity",
  rep: "Reputation",
  lang: "Language",
};

const WEIGHT_KEYS = Object.keys(WEIGHT_LABELS) as (keyof MatchingWeights)[];

// design.md §14.20's "blocks save unless the weights total exactly
// 1.00" — the backend's own tolerance (packages/matching/src/weights.ts's
// WEIGHT_SUM_TOLERANCE) is 1e-9, tight enough that it's effectively
// "exactly." This client-side gate uses a slightly looser epsilon to
// absorb float accumulation from summing 11 user-edited decimals, while
// still rejecting anything a human would recognize as off — the server
// is the actual authority either way (PUT rejects with VALIDATION_FAILED
// if this check is ever wrong).
const SUM_EPSILON = 1e-6;

function sumWeights(weights: MatchingWeights): number {
  return WEIGHT_KEYS.reduce((total, key) => total + weights[key], 0);
}

async function fetchWeights(): Promise<MatchingWeights> {
  const response = await fetch("/api/admin/matching/weights");
  if (!response.ok) throw new Error("Failed to load matching weights");
  return (await response.json()) as MatchingWeights;
}

export function MatchingWeightsScreen() {
  const queryClient = useQueryClient();
  const {
    data: live,
    isLoading,
    isError,
    refetch,
  } = useQuery({ queryKey: qk.admin.matchingWeights(), queryFn: fetchWeights });

  const [draft, setDraft] = useState<MatchingWeights | null>(null);
  // Tracks which server snapshot `draft` was last seeded from, so a
  // fresh GET result (initial load, or the response written back after
  // save/rollback) can re-seed the draft without an effect — this is
  // React's documented "adjust state during rendering" pattern, not a
  // cascading useEffect setState.
  const [seededFrom, setSeededFrom] = useState<MatchingWeights | null>(null);
  const [reason, setReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [rollbackReason, setRollbackReason] = useState("");
  const [showRollback, setShowRollback] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (live && live !== seededFrom) {
    setSeededFrom(live);
    setDraft(live);
  }

  const sum = draft ? sumWeights(draft) : 0;
  const sumIsValid = Math.abs(sum - 1) < SUM_EPSILON;
  const hasChanges = draft && live ? WEIGHT_KEYS.some((key) => draft[key] !== live[key]) : false;
  const canSave = sumIsValid && hasChanges && reason.trim().length > 0 && !isSaving;

  async function save() {
    if (!draft) return;
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/matching/weights", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, reason: reason.trim() }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message: string };
        } | null;
        setError(body?.error?.message ?? "Something went wrong. Please try again.");
        return;
      }
      const updated = (await response.json()) as MatchingWeights;
      queryClient.setQueryData(qk.admin.matchingWeights(), updated);
      setSeededFrom(updated);
      setDraft(updated);
      setReason("");
      pushToast({
        variant: "success",
        message: "Weights updated — logged to audit.",
        durationMs: 4000,
      });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  async function rollback() {
    if (!rollbackReason.trim()) return;
    setIsRollingBack(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/matching/weights/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rollbackReason.trim() }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message: string };
        } | null;
        setError(body?.error?.message ?? "Couldn't roll back. Try again.");
        return;
      }
      const restored = (await response.json()) as MatchingWeights;
      queryClient.setQueryData(qk.admin.matchingWeights(), restored);
      setSeededFrom(restored);
      setDraft(restored);
      setRollbackReason("");
      setShowRollback(false);
      pushToast({
        variant: "success",
        message: "Rolled back to the previous configuration — logged to audit.",
        durationMs: 4000,
      });
    } catch {
      setError("Couldn't roll back. Try again.");
    } finally {
      setIsRollingBack(false);
    }
  }

  return (
    <div className="flex-1 px-[var(--spacing-24)] py-[var(--spacing-24)]">
      <div className="mb-[var(--spacing-16)] flex items-center justify-between">
        <h1 className="text-[length:var(--text-heading-sm)] font-medium text-[color:var(--color-ink)]">
          Matching weights
        </h1>
        <button
          type="button"
          onClick={() => setShowRollback((open) => !open)}
          className="min-h-11 rounded-[var(--radius-buttons)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
        >
          Rollback…
        </button>
      </div>

      {isLoading && (
        <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
          Loading…
        </p>
      )}
      {isError && (
        <div
          role="alert"
          className="text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]"
        >
          Couldn&apos;t load the live weights.{" "}
          <button type="button" onClick={() => void refetch()} className="underline">
            Retry
          </button>
        </div>
      )}

      {showRollback && (
        <div className="mb-[var(--spacing-16)] rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]">
          <p className="mb-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
            Restore the configuration that was live before this one, in one action.
          </p>
          <label
            htmlFor="rollback-reason"
            className="block text-[length:var(--text-caption)] text-[color:var(--color-graphite)]"
          >
            Reason (required)
          </label>
          <input
            id="rollback-reason"
            value={rollbackReason}
            onChange={(event) => setRollbackReason(event.target.value)}
            className="mt-[var(--spacing-8)] min-h-11 w-full rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)]"
          />
          <button
            type="button"
            disabled={!rollbackReason.trim() || isRollingBack}
            onClick={() => void rollback()}
            className="mt-[var(--spacing-16)] min-h-11 rounded-[var(--radius-buttons)] bg-[color:var(--color-danger-text)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)] disabled:opacity-50"
          >
            {isRollingBack ? "Rolling back…" : "Confirm rollback — logged to audit"}
          </button>
        </div>
      )}

      {draft && live && (
        <>
          <table className="w-full border-collapse text-[length:var(--text-body-sm)]">
            <thead>
              <tr className="border-b border-[color:var(--color-mist-gray)] text-left text-[length:var(--text-caption)] uppercase tracking-[var(--tracking-caption)] text-[color:var(--color-graphite)]">
                <th scope="col" className="py-[var(--spacing-8)]">
                  Weight
                </th>
                <th scope="col">Live</th>
                <th scope="col">New</th>
              </tr>
            </thead>
            <tbody>
              {WEIGHT_KEYS.map((key) => {
                const changed = draft[key] !== live[key];
                return (
                  <tr key={key} className="border-b border-[color:var(--color-mist-gray)]">
                    <td className="py-[var(--spacing-8)]">{WEIGHT_LABELS[key]}</td>
                    <td className="numeric text-[color:var(--color-graphite)]">
                      {live[key].toFixed(2)}
                    </td>
                    <td>
                      <label htmlFor={`weight-${key}`} className="sr-only">
                        {WEIGHT_LABELS[key]}
                      </label>
                      <input
                        id={`weight-${key}`}
                        type="number"
                        step={0.01}
                        min={0}
                        max={1}
                        value={draft[key]}
                        onChange={(event) =>
                          setDraft({ ...draft, [key]: Number(event.target.value) })
                        }
                        className={`numeric min-h-11 w-24 rounded-[var(--radius-inputs)] border px-[var(--spacing-8)] text-[length:var(--text-body-sm)] ${changed ? "border-[color:var(--color-iris-blue)]" : "border-[color:var(--color-mist-gray)]"}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p
            className={`mt-[var(--spacing-16)] text-[length:var(--text-body-sm)] font-medium ${sumIsValid ? "text-[color:var(--color-ink)]" : "text-[color:var(--color-danger-text)]"}`}
          >
            Sum: <span className="numeric">{sum.toFixed(4)}</span>{" "}
            {sumIsValid ? "" : "— must total exactly 1.00 to save"}
          </p>

          <label
            htmlFor="change-reason"
            className="mt-[var(--spacing-16)] block text-[length:var(--text-caption)] text-[color:var(--color-graphite)]"
          >
            Change reason (required)
          </label>
          <textarea
            id="change-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
            className="mt-[var(--spacing-8)] w-full rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)]"
          />

          {error && (
            <p
              role="alert"
              className="mt-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]"
            >
              {error}
            </p>
          )}

          <button
            type="button"
            disabled={!canSave}
            onClick={() => void save()}
            className="mt-[var(--spacing-16)] min-h-11 rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)] disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Save — logged to audit"}
          </button>
        </>
      )}
    </div>
  );
}
