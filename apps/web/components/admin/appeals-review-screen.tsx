"use client";

import { safety as safetyValidation } from "@convene/validation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AdminAppealCard } from "@/lib/api/client";
import { qk } from "@/lib/api/query-keys";
import { pushToast } from "@/stores/ui";

async function fetchAppeals(status: string): Promise<{ appeals: AdminAppealCard[] }> {
  const query = new URLSearchParams();
  if (status) query.set("status", status);
  const response = await fetch(`/api/admin/appeals?${query.toString()}`);
  if (!response.ok) throw new Error("Failed to load appeals");
  return (await response.json()) as { appeals: AdminAppealCard[] };
}

// design.md §14.20's "Appeals" nav item. §10.10.3: "reviewed by a
// different admin than the one who acted" — AppealsService.review()
// already enforces APPEAL_REVIEWER_CONFLICT server-side; a reviewer who
// also acted on the underlying moderation action gets that error back
// from the API, surfaced inline the same way every other server
// rejection is on this screen.
export function AppealsReviewScreen() {
  const [status, setStatus] = useState("pending");
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: qk.admin.appeals(status),
    queryFn: () => fetchAppeals(status),
  });

  return (
    <div className="flex-1 px-[var(--spacing-24)] py-[var(--spacing-24)]">
      <div className="mb-[var(--spacing-16)] flex items-center justify-between">
        <h1 className="text-[length:var(--text-heading-sm)] font-medium text-[color:var(--color-ink)]">
          Appeals
        </h1>
        <select
          aria-label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-8)] text-[length:var(--text-body-sm)]"
        >
          <option value="pending">Pending</option>
          <option value="upheld">Upheld</option>
          <option value="overturned">Overturned</option>
          <option value="">All</option>
        </select>
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
          Couldn&apos;t load appeals.{" "}
          <button type="button" onClick={() => void refetch()} className="underline">
            Retry
          </button>
        </div>
      )}
      {!isLoading && !isError && data?.appeals.length === 0 && (
        <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
          Nothing here.
        </p>
      )}

      {!isLoading && !isError && data && data.appeals.length > 0 && (
        <ul className="flex flex-col gap-[var(--spacing-16)]">
          {data.appeals.map((appeal) => (
            <AppealRow
              key={appeal.id}
              appeal={appeal}
              onChanged={() =>
                void queryClient.invalidateQueries({ queryKey: ["admin", "appeals"] })
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AppealRow({ appeal, onChanged }: { appeal: AdminAppealCard; onChanged: () => void }) {
  const [decision, setDecision] = useState<"upheld" | "overturned" | "">("");
  const [rationale, setRationale] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = Boolean(decision) && rationale.trim().length > 0 && !isSubmitting;

  async function review() {
    if (!decision) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/appeals/${appeal.id}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, rationale: rationale.trim() }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message: string };
        } | null;
        setError(body?.error?.message ?? "Something went wrong. Please try again.");
        return;
      }
      pushToast({ variant: "success", message: "Appeal decision recorded.", durationMs: 3000 });
      onChanged();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <li className="rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]">
      <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
        Appeal on moderation action{" "}
        <span className="font-medium">{appeal.moderation_action_id}</span> · {appeal.status}
      </p>

      {appeal.status === "pending" && (
        <div className="mt-[var(--spacing-16)]">
          <fieldset>
            <legend className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
              Decision
            </legend>
            <div className="mt-[var(--spacing-8)] flex gap-[var(--spacing-16)]">
              {safetyValidation.REVIEW_APPEAL_DECISIONS.map((value) => (
                <label key={value} className="flex min-h-11 items-center gap-[var(--spacing-8)]">
                  <input
                    type="radio"
                    name={`decision-${appeal.id}`}
                    value={value}
                    checked={decision === value}
                    onChange={() => setDecision(value)}
                  />
                  <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
                    {value}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <label
            htmlFor={`appeal-rationale-${appeal.id}`}
            className="mt-[var(--spacing-8)] block text-[length:var(--text-caption)] text-[color:var(--color-graphite)]"
          >
            Rationale (required)
          </label>
          <textarea
            id={`appeal-rationale-${appeal.id}`}
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
            rows={2}
            maxLength={2000}
            className="mt-[var(--spacing-8)] w-full rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)]"
          />

          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void review()}
            className="mt-[var(--spacing-16)] min-h-11 rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)] disabled:opacity-50"
          >
            {isSubmitting ? "Submitting…" : "Submit decision"}
          </button>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="mt-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]"
        >
          {error}
        </p>
      )}
    </li>
  );
}
