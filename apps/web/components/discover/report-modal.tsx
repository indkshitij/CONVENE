"use client";

import { safety as safetyValidation } from "@convene/validation";
import { useState } from "react";
import { pushToast } from "@/stores/ui";

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

export function ReportModal({
  candidateId,
  onClose,
}: {
  candidateId: string;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<string>("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!category) {
      setError("Choose a reason.");
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_type: "user",
          target_id: candidateId,
          target_user_id: candidateId,
          category,
          description: description.trim() || undefined,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error: { message: string } };
        setError(body.error.message || "Something went wrong. Please try again.");
        return;
      }
      pushToast({ variant: "success", message: "Report submitted.", durationMs: 4000 });
      onClose();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-modal-heading"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-[var(--spacing-16)]"
    >
      <form
        onSubmit={(event) => void onSubmit(event)}
        className="w-full max-w-sm rounded-[var(--radius-cards)] bg-[color:var(--color-paper-white)] p-[var(--spacing-24)]"
      >
        <h2
          id="report-modal-heading"
          className="text-[length:var(--text-body-lg)] font-medium text-[color:var(--color-ink)]"
        >
          Report this profile
        </h2>

        <fieldset className="mt-[var(--spacing-16)]">
          <legend className="mb-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
            Reason
          </legend>
          <div className="flex flex-col gap-[var(--spacing-8)]">
            {safetyValidation.REPORT_CATEGORIES.map((value) => (
              <label key={value} className="flex min-h-11 items-center gap-[var(--spacing-8)]">
                <input
                  type="radio"
                  name="category"
                  value={value}
                  checked={category === value}
                  onChange={() => setCategory(value)}
                />
                <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
                  {CATEGORY_LABELS[value] ?? value}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label
          htmlFor="report-description"
          className="mt-[var(--spacing-16)] block text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]"
        >
          Additional details (optional)
        </label>
        <textarea
          id="report-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={2000}
          rows={3}
          className="mt-[var(--spacing-8)] w-full rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
        />

        {error && (
          <p
            role="alert"
            className="mt-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]"
          >
            {error}
          </p>
        )}

        <div className="mt-[var(--spacing-16)] flex gap-[var(--spacing-8)]">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 flex-1 rounded-[var(--radius-buttons)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="min-h-11 flex-1 rounded-[var(--radius-buttons)] bg-[color:var(--color-danger-text)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)] disabled:opacity-50"
          >
            {isSubmitting ? "Submitting…" : "Submit report"}
          </button>
        </div>
      </form>
    </div>
  );
}
