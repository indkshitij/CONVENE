"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AdminModerationActionCard } from "@/lib/api/client";
import { qk } from "@/lib/api/query-keys";
import { pushToast } from "@/stores/ui";

async function fetchModerationActions(
  status: string,
): Promise<{ moderation_actions: AdminModerationActionCard[] }> {
  const query = new URLSearchParams();
  if (status) query.set("status", status);
  const response = await fetch(`/api/admin/moderation-actions?${query.toString()}`);
  if (!response.ok) throw new Error("Failed to load moderation actions");
  return (await response.json()) as { moderation_actions: AdminModerationActionCard[] };
}

// design.md §14.20's "Moderation" nav item. §10.10.3: a permanent ban
// starts pending_approval until a second, different admin approves it —
// ModerationActionsService.approve() already enforces
// BAN_APPROVAL_SAME_ADMIN/ALREADY_APPROVED server-side; this screen just
// surfaces the queue and lets the error message (if the current admin
// is the one who requested it) come straight from the server rather than
// re-deriving the same check client-side.
export function ModerationApprovalScreen() {
  const [status, setStatus] = useState("pending_approval");
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: qk.admin.moderationActions(status),
    queryFn: () => fetchModerationActions(status),
  });

  return (
    <div className="flex-1 px-[var(--spacing-24)] py-[var(--spacing-24)]">
      <div className="mb-[var(--spacing-16)] flex items-center justify-between">
        <h1 className="text-[length:var(--text-heading-sm)] font-medium text-[color:var(--color-ink)]">
          Moderation — ban approvals
        </h1>
        <select
          aria-label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-8)] text-[length:var(--text-body-sm)]"
        >
          <option value="pending_approval">Pending approval</option>
          <option value="active">Active</option>
          <option value="reversed">Reversed</option>
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
          Couldn&apos;t load moderation actions.{" "}
          <button type="button" onClick={() => void refetch()} className="underline">
            Retry
          </button>
        </div>
      )}
      {!isLoading && !isError && data?.moderation_actions.length === 0 && (
        <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
          Nothing here.
        </p>
      )}

      {!isLoading && !isError && data && data.moderation_actions.length > 0 && (
        <ul className="flex flex-col gap-[var(--spacing-16)]">
          {data.moderation_actions.map((action) => (
            <ModerationActionRow
              key={action.id}
              action={action}
              onChanged={() =>
                void queryClient.invalidateQueries({ queryKey: ["admin", "moderationActions"] })
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ModerationActionRow({
  action,
  onChanged,
}: {
  action: AdminModerationActionCard;
  onChanged: () => void;
}) {
  const [rationale, setRationale] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/moderation-actions/${action.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rationale: rationale.trim() || "Approved." }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message: string };
        } | null;
        setError(body?.error?.message ?? "Something went wrong. Please try again.");
        return;
      }
      pushToast({ variant: "success", message: "Approval recorded.", durationMs: 3000 });
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
        <span className="font-medium">{action.action}</span> on{" "}
        {action.target_user_id ?? "(no target)"} · {action.policy_clause}
      </p>
      <p className="mt-[var(--spacing-8)] text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
        {action.rationale}
      </p>

      {action.status === "pending_approval" && (
        <div className="mt-[var(--spacing-16)] flex flex-col gap-[var(--spacing-8)] sm:flex-row sm:items-center">
          <label htmlFor={`approval-rationale-${action.id}`} className="sr-only">
            Approval rationale
          </label>
          <input
            id={`approval-rationale-${action.id}`}
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
            placeholder="Approval note (optional)"
            className="min-h-11 flex-1 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)]"
          />
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => void approve()}
            className="min-h-11 rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)] disabled:opacity-50"
          >
            {isSubmitting ? "Approving…" : "Approve"}
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
