"use client";

import { safety as safetyValidation } from "@convene/validation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import type { AdminReportCard, AdminReportContent } from "@/lib/api/client";
import { qk } from "@/lib/api/query-keys";
import { pushToast } from "@/stores/ui";
import { POLICY_CLAUSES } from "./policy-clauses";

const CATEGORY_LABELS: Record<string, string> = {
  child_safety: "Child safety",
  threats_violence: "Threats or violence",
  harassment_hate: "Harassment or hate",
  scam_fraud: "Scam or fraud",
  sexual_content: "Sexual content",
  impersonation: "Impersonation",
  spam: "Spam",
  other: "Other",
};

const SEVERITY_DOT: Record<string, string> = {
  critical: "var(--color-danger-text)",
  high: "var(--availability-busy)",
  medium: "var(--color-iris-blue)",
  low: "var(--color-fog)",
};

// §10.10.3's enforcement ladder, minus "reverse" (a separate action on an
// existing moderation_action, not something the report queue's action
// panel applies fresh).
const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: "notice", label: "Notice" },
  { value: "warning", label: "Warning" },
  { value: "throttle", label: "Throttle 7d" },
  { value: "shadow_limit", label: "Shadow-limit 14d" },
  { value: "suspend", label: "Suspend" },
  { value: "ban", label: "Ban (requires 2nd admin)" },
];

const REPORT_STATUS_OPTIONS = safetyValidation.REPORT_STATUSES;

async function fetchReports(
  status: string,
  severity: string,
  category: string,
): Promise<{ reports: AdminReportCard[] }> {
  const query = new URLSearchParams();
  if (status) query.set("status", status);
  if (severity) query.set("severity", severity);
  if (category) query.set("category", category);
  const response = await fetch(`/api/admin/reports?${query.toString()}`);
  if (!response.ok) throw new Error("Failed to load reports");
  return (await response.json()) as { reports: AdminReportCard[] };
}

async function fetchReportContent(reportId: string): Promise<AdminReportContent> {
  const response = await fetch(`/api/admin/reports/${reportId}/content`);
  if (!response.ok) throw new Error("Failed to load report content");
  return (await response.json()) as AdminReportContent;
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours}:${minutes.toString().padStart(2, "0")}`;
}

function formatSla(iso: string): { text: string; breached: boolean } {
  const ms = new Date(iso).getTime() - Date.now();
  const breached = ms <= 0;
  const abs = Math.abs(ms);
  const hours = Math.floor(abs / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  return {
    text: breached ? "BREACH" : `${hours}:${minutes.toString().padStart(2, "0")}`,
    breached,
  };
}

export function ReportQueueScreen() {
  const [status, setStatus] = useState("open");
  const [severity, setSeverity] = useState("");
  const [category, setCategory] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: qk.admin.reports(status, severity, category),
    queryFn: () => fetchReports(status, severity, category),
  });

  async function updateStatus(reportId: string, nextStatus: string) {
    try {
      const response = await fetch(`/api/admin/reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!response.ok) throw new Error("Failed to update report");
      await queryClient.invalidateQueries({ queryKey: ["admin", "reports"] });
      pushToast({ variant: "success", message: "Report updated.", durationMs: 3000 });
    } catch {
      pushToast({
        variant: "error",
        message: "Couldn't update the report. Try again.",
        durationMs: 4000,
      });
    }
  }

  return (
    <div className="flex-1 px-[var(--spacing-24)] py-[var(--spacing-24)]">
      <div className="mb-[var(--spacing-16)] flex items-center justify-between">
        <h1 className="text-[length:var(--text-heading-sm)] font-medium text-[color:var(--color-ink)]">
          Reports{data ? ` (${data.reports.length})` : ""}
        </h1>
        <button
          type="button"
          onClick={() => void refetch()}
          className="min-h-11 rounded-[var(--radius-buttons)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
        >
          Refresh
        </button>
      </div>

      <div className="mb-[var(--spacing-16)] flex flex-wrap gap-[var(--spacing-8)]">
        <select
          aria-label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-8)] text-[length:var(--text-body-sm)]"
        >
          <option value="">All statuses</option>
          {REPORT_STATUS_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          aria-label="Severity"
          value={severity}
          onChange={(event) => setSeverity(event.target.value)}
          className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-8)] text-[length:var(--text-body-sm)]"
        >
          <option value="">All severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          aria-label="Category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-8)] text-[length:var(--text-body-sm)]"
        >
          <option value="">All categories</option>
          {safetyValidation.REPORT_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {CATEGORY_LABELS[value] ?? value}
            </option>
          ))}
        </select>
      </div>

      {isLoading && (
        <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
          Loading reports…
        </p>
      )}
      {isError && (
        <div
          role="alert"
          className="text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]"
        >
          Couldn&apos;t load reports.{" "}
          <button type="button" onClick={() => void refetch()} className="underline">
            Retry
          </button>
        </div>
      )}
      {!isLoading && !isError && data?.reports.length === 0 && (
        <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
          Queue clear — nice.
        </p>
      )}

      {!isLoading && !isError && data && data.reports.length > 0 && (
        <table className="w-full border-collapse text-[length:var(--text-body-sm)]">
          <thead>
            <tr className="border-b border-[color:var(--color-mist-gray)] text-left text-[length:var(--text-caption)] uppercase tracking-[var(--tracking-caption)] text-[color:var(--color-graphite)]">
              <th scope="col" className="py-[var(--spacing-8)]">
                Severity
              </th>
              <th scope="col">Category</th>
              <th scope="col">Target</th>
              <th scope="col">Age</th>
              <th scope="col">SLA</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.reports.map((report) => {
              const sla = formatSla(report.sla_due_at);
              const isExpanded = expandedId === report.id;
              return (
                <Fragment key={report.id}>
                  <tr className="border-b border-[color:var(--color-mist-gray)]">
                    <td className="py-[var(--spacing-8)]">
                      <span className="inline-flex items-center gap-[var(--spacing-8)]">
                        <span
                          aria-hidden="true"
                          className="inline-block h-2 w-2 rounded-full"
                          style={{
                            backgroundColor: SEVERITY_DOT[report.severity] ?? "var(--color-fog)",
                          }}
                        />
                        {report.severity}
                      </span>
                    </td>
                    <td>{CATEGORY_LABELS[report.category] ?? report.category}</td>
                    <td className="font-[family-name:var(--font-geist)]">
                      <span className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                        {report.target_user_id ?? report.target_id}
                      </span>
                    </td>
                    <td className="numeric">{formatAge(report.created_at)}</td>
                    <td
                      className={`numeric ${sla.breached ? "font-medium text-[color:var(--color-danger-text)]" : ""}`}
                    >
                      {sla.text}
                    </td>
                    <td>
                      <select
                        aria-label={`Status for report ${report.reference}`}
                        value={report.status}
                        onChange={(event) => void updateStatus(report.id, event.target.value)}
                        className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-8)] text-[length:var(--text-caption)]"
                      >
                        {REPORT_STATUS_OPTIONS.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : report.id)}
                        aria-expanded={isExpanded}
                        className="min-h-11 rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-[var(--spacing-16)] text-[length:var(--text-caption)] text-[color:var(--color-paper-white)]"
                      >
                        {isExpanded ? "Close" : "Review"}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td
                        colSpan={7}
                        className="bg-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-16)]"
                      >
                        <ReportReviewPanel report={report} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ReportReviewPanel({ report }: { report: AdminReportCard }) {
  const queryClient = useQueryClient();
  const [policyClause, setPolicyClause] = useState("");
  const [rationale, setRationale] = useState("");
  const [action, setAction] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    data: content,
    isLoading: isContentLoading,
    isError: isContentError,
  } = useQuery({
    queryKey: qk.admin.reportContent(report.id),
    queryFn: () => fetchReportContent(report.id),
  });

  const canSubmit =
    Boolean(policyClause) &&
    rationale.trim().length > 0 &&
    Boolean(action) &&
    Boolean(report.target_user_id) &&
    !isSubmitting;

  async function applyAction() {
    if (!report.target_user_id) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/moderation-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_user_id: report.target_user_id,
          report_id: report.id,
          action,
          policy_clause: policyClause,
          rationale: rationale.trim(),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message: string };
        } | null;
        setError(body?.error?.message ?? "Something went wrong. Please try again.");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["admin", "moderationActions"] });
      pushToast({
        variant: "success",
        message:
          action === "ban"
            ? "Ban recorded, pending a second admin's approval."
            : "Action applied — logged to audit.",
        durationMs: 4000,
      });
      setPolicyClause("");
      setRationale("");
      setAction("");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-16)] md:flex-row">
      <div className="flex-1">
        <h2 className="mb-[var(--spacing-8)] text-[length:var(--text-body-sm)] font-medium text-[color:var(--color-ink)]">
          Reported content
        </h2>
        {/* design.md §14.20: content shown here must be "visibly marked as
            logged access" — AdminReportsController.content() writes the
            audit_logs row server-side before this ever renders; this line
            is that access's visible, user-facing acknowledgment. */}
        <p className="mb-[var(--spacing-8)] text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
          🔒 Viewing this content is logged to the audit trail.
        </p>
        {isContentLoading && (
          <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
            Loading…
          </p>
        )}
        {isContentError && (
          <p className="text-[length:var(--text-caption)] text-[color:var(--color-danger-text)]">
            Couldn&apos;t load the reported content.
          </p>
        )}
        {content?.status === "ok" && "message" in content && (
          <div className="rounded-[var(--radius-inputs)] bg-[color:var(--color-paper-white)] p-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
            <p className="mb-[var(--spacing-8)] text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
              Message · {content.message.moderation_state} ·{" "}
              {new Date(content.message.created_at).toLocaleString()}
            </p>
            <p>{content.message.body ?? "(no body — deleted or removed)"}</p>
          </div>
        )}
        {content?.status === "ok" && "profile" in content && (
          <div className="rounded-[var(--radius-inputs)] bg-[color:var(--color-paper-white)] p-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
            <p className="font-medium">{content.profile.full_name}</p>
            <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
              {content.profile.headline}
            </p>
          </div>
        )}
        {content?.status === "content_unavailable" && (
          <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
            This content is no longer available.
          </p>
        )}
        {content?.status === "unsupported_target_type" && (
          <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
            No content viewer exists yet for &quot;{content.target_type}&quot; reports — review the
            description/evidence below instead.
          </p>
        )}
        {report.description && (
          <p className="mt-[var(--spacing-8)] text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
            Reporter note: {report.description}
          </p>
        )}
      </div>

      <div className="flex-1">
        <h2 className="mb-[var(--spacing-8)] text-[length:var(--text-body-sm)] font-medium text-[color:var(--color-ink)]">
          Take action
        </h2>
        {!report.target_user_id && (
          <p className="mb-[var(--spacing-8)] text-[length:var(--text-caption)] text-[color:var(--color-danger-text)]">
            This report has no target user — no enforcement action can be applied.
          </p>
        )}

        <label
          htmlFor={`policy-clause-${report.id}`}
          className="block text-[length:var(--text-caption)] text-[color:var(--color-graphite)]"
        >
          Policy clause (required)
        </label>
        <select
          id={`policy-clause-${report.id}`}
          value={policyClause}
          onChange={(event) => setPolicyClause(event.target.value)}
          className="mt-[var(--spacing-8)] min-h-11 w-full rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-8)] text-[length:var(--text-body-sm)]"
        >
          <option value="">Select a clause…</option>
          {POLICY_CLAUSES.map((clause) => (
            <option key={clause.value} value={clause.value}>
              {clause.label}
            </option>
          ))}
        </select>

        <label
          htmlFor={`rationale-${report.id}`}
          className="mt-[var(--spacing-16)] block text-[length:var(--text-caption)] text-[color:var(--color-graphite)]"
        >
          Rationale (required)
        </label>
        <textarea
          id={`rationale-${report.id}`}
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
          rows={3}
          maxLength={2000}
          className="mt-[var(--spacing-8)] w-full rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)]"
        />

        <fieldset className="mt-[var(--spacing-16)]">
          <legend className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
            Action
          </legend>
          <div className="mt-[var(--spacing-8)] flex flex-col gap-[var(--spacing-8)]">
            {ACTION_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex min-h-11 items-center gap-[var(--spacing-8)]"
              >
                <input
                  type="radio"
                  name={`action-${report.id}`}
                  value={option.value}
                  checked={action === option.value}
                  onChange={() => setAction(option.value)}
                />
                <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
                  {option.label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

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
          disabled={!canSubmit}
          onClick={() => void applyAction()}
          className="mt-[var(--spacing-16)] min-h-11 rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)] disabled:opacity-50"
        >
          {isSubmitting ? "Applying…" : "Apply — logged to audit"}
        </button>
      </div>
    </div>
  );
}
