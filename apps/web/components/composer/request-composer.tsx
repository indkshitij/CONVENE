"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { computeCountdown, formatCountdown } from "@/lib/availability/countdown";
import { bestComplementIntentId } from "@/lib/composer/best-complement";
import { ICEBREAKER_TEMPLATES } from "@/lib/composer/icebreaker-templates";
import type { IcebreakersResult, IntentResponse, IntentTaxonomyEntry } from "@/lib/api/client";

async function fetchAiIcebreakers(candidateId: string): Promise<IcebreakersResult> {
  const response = await fetch("/api/ai/icebreakers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidate_id: candidateId }),
  });
  if (!response.ok) return { status: "unavailable" };
  return (await response.json()) as IcebreakersResult;
}

const NOTE_MAX_LENGTH = 300; // packages/validation's connectionNoteSchema.

function humanize(type: string): string {
  return type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

interface Quota {
  used: number;
  limit: number;
  resets_at?: string;
}

export function RequestComposer({
  recipientId,
  recipientName,
  recipientHeadline,
  recipientAvailability,
  ownIntents,
  taxonomy,
  recipientPrimaryIntentType,
  matchScore,
  onClose,
  onSent,
}: {
  recipientId: string;
  recipientName: string;
  recipientHeadline: string | null;
  recipientAvailability: { state: string; expires_at: string | null } | null;
  ownIntents: IntentResponse[];
  taxonomy: IntentTaxonomyEntry[];
  recipientPrimaryIntentType: string | null;
  matchScore?: number | undefined;
  onClose: () => void;
  onSent?: () => void;
}) {
  const pathname = usePathname();
  const [intentId, setIntentId] = useState<string>(
    () => bestComplementIntentId(ownIntents, taxonomy, recipientPrimaryIntentType) ?? "",
  );
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPaywall, setIsPaywall] = useState(false);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [result, setResult] = useState<
    { kind: "sent" } | { kind: "queued"; position: number | null } | null
  >(null);
  const [noteSource, setNoteSource] = useState<"manual" | "ai" | "template">("manual");

  const intentLabel = humanize(
    taxonomy.find(
      (entry) => entry.type === ownIntents.find((intent) => intent.id === intentId)?.type,
    )?.type ?? "connecting",
  );
  const isAvailableNow = recipientAvailability?.state === "available_now";
  const countdown =
    isAvailableNow && recipientAvailability?.expires_at
      ? computeCountdown(recipientAvailability.expires_at)
      : null;

  // §12.12's degraded mode: "icebreakers show curated templates" when
  // the feature is unavailable — ICEBREAKER_TEMPLATES always renders
  // regardless of this query's outcome, AI suggestions are additive when
  // present, never a replacement the UI depends on.
  const { data: aiIcebreakers } = useQuery({
    queryKey: ["ai-icebreakers", recipientId],
    queryFn: () => fetchAiIcebreakers(recipientId),
  });

  function insertTemplate(template: (typeof ICEBREAKER_TEMPLATES)[number]) {
    // Inserting only ever fills the editable field — it never submits
    // anything. The user must still press "Send request" as a separate,
    // explicit action (§12.5's own hard rule, this composer's own
    // acceptance line).
    setNote(template.build({ recipientName, recipientHeadline, intentLabel }));
    setNoteSource("template");
  }

  function insertAiOpener(text: string) {
    setNote(text);
    setNoteSource("ai");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!intentId) {
      setError("Choose your intent.");
      return;
    }
    setError(null);
    setIsPaywall(false);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/connections/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient_id: recipientId,
          intent_id: intentId,
          note: note.trim() || undefined,
          source: "request_composer",
          match_score: matchScore,
        }),
      });
      const body = (await response.json()) as {
        request?: { id: string; status: string; expires_at: string };
        quota?: Quota;
        queued_position?: number;
        error?: { code: string; message: string; details?: { quota?: Quota } | null };
      };

      if (response.status === 202) {
        if (body.quota) setQuota(body.quota);
        setResult({ kind: "queued", position: body.queued_position ?? null });
        return;
      }
      if (!response.ok) {
        if (body.error?.code === "DAILY_LIMIT_REACHED") {
          setIsPaywall(true);
          if (body.error.details?.quota) setQuota(body.error.details.quota);
        }
        setError(body.error?.message || "Something went wrong. Please try again.");
        return;
      }

      if (body.quota) setQuota(body.quota);
      setResult({ kind: "sent" });
      // BR-CONN-08: the request note is the conversation's first message
      // — §12.5's guardrail metric (>60% AI-drafted first messages) is
      // recorded here, fire-and-forget, never blocking the send.
      if (note.trim())
        void fetch("/api/ai/first-message-metric", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ai_drafted: noteSource === "ai" }),
        }).catch(() => undefined);
      onSent?.();
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
      aria-labelledby="composer-heading"
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center"
    >
      <div className="w-full max-w-md rounded-t-[var(--radius-cards)] bg-[color:var(--color-paper-white)] p-[var(--spacing-24)] sm:rounded-[var(--radius-cards)]">
        <div className="flex items-center justify-between">
          <h2
            id="composer-heading"
            className="text-[length:var(--text-body-lg)] font-medium text-[color:var(--color-ink)]"
          >
            Connect with {recipientName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-h-11 min-w-11 text-[length:var(--text-body)] text-[color:var(--color-graphite)]"
          >
            ✕
          </button>
        </div>

        {result ? (
          <div className="mt-[var(--spacing-16)]">
            {result.kind === "sent" ? (
              <p
                role="status"
                className="text-[length:var(--text-body)] text-[color:var(--color-ink)]"
              >
                Request sent to {recipientName}.
              </p>
            ) : (
              // §10.6.6: 429 RECIPIENT_THROTTLED -> queued, 202, queued_position.
              // No exact copy is given anywhere in the PRD for this state —
              // written, not transcribed.
              <p
                role="status"
                className="text-[length:var(--text-body)] text-[color:var(--color-ink)]"
              >
                {recipientName} receives a limited number of requests per day.
                {result.position !== null
                  ? ` Yours is #${result.position} in the queue — `
                  : " Yours is queued — "}
                they&apos;ll see it once earlier ones clear.
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-[var(--spacing-16)] min-h-11 w-full rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-8 py-3 text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)]"
            >
              Done
            </button>
          </div>
        ) : (
          <form
            onSubmit={(event) => void submit(event)}
            className="mt-[var(--spacing-16)] flex flex-col gap-[var(--spacing-16)]"
          >
            <div className="flex items-center gap-[var(--spacing-8)] rounded-[var(--radius-cards)] bg-[color:var(--color-mist-gray)] p-[var(--spacing-8)]">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[color:var(--color-paper-white)] text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]"
              >
                {recipientName.charAt(0)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[length:var(--text-body-sm)] font-medium text-[color:var(--color-ink)]">
                  {recipientName}
                </p>
                {recipientHeadline && (
                  <p className="truncate text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                    {recipientHeadline}
                  </p>
                )}
              </div>
              {countdown && (
                <span className="numeric shrink-0 text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                  <span aria-hidden="true" style={{ color: "var(--availability-available-now)" }}>
                    ●
                  </span>{" "}
                  Available · {formatCountdown(countdown.remainingMs)}
                </span>
              )}
            </div>

            <div>
              <label
                htmlFor="composer-intent"
                className="mb-[var(--spacing-8)] block text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]"
              >
                Your intent
              </label>
              <select
                id="composer-intent"
                value={intentId}
                onChange={(event) => setIntentId(event.target.value)}
                className="min-h-11 w-full rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
              >
                <option value="">Select an intent</option>
                {ownIntents.map((intent) => (
                  <option key={intent.id} value={intent.id}>
                    {humanize(intent.type)}
                  </option>
                ))}
              </select>
            </div>

            {aiIcebreakers?.status === "ok" &&
              aiIcebreakers.openers &&
              aiIcebreakers.openers.length > 0 && (
                <fieldset>
                  <legend className="mb-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
                    ✦ AI Suggested (optional — tap to insert, then edit)
                  </legend>
                  <div className="flex flex-col gap-[var(--spacing-8)]">
                    {aiIcebreakers.openers.map((opener) => (
                      <button
                        key={opener.type}
                        type="button"
                        onClick={() => insertAiOpener(opener.text)}
                        className="min-h-11 rounded-[var(--radius-cards)] border border-[color:var(--color-lavender-wash)] bg-[color:var(--color-lavender-wash)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-left text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
                      >
                        <span className="mb-1 block text-[length:var(--text-caption)] font-medium text-[color:var(--color-graphite)] uppercase">
                          ✦ AI Suggested · {humanize(opener.type)}
                        </span>
                        {opener.text}
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}

            <fieldset>
              <legend className="mb-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
                Templates (optional — tap to insert, then edit)
              </legend>
              <div className="flex flex-col gap-[var(--spacing-8)]">
                {ICEBREAKER_TEMPLATES.map((template) => (
                  <button
                    key={template.type}
                    type="button"
                    onClick={() => insertTemplate(template)}
                    className="min-h-11 rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-left text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
                  >
                    <span className="mb-1 block text-[length:var(--text-caption)] font-medium text-[color:var(--color-graphite)] uppercase">
                      {template.label} · Template
                    </span>
                    {template.build({ recipientName, recipientHeadline, intentLabel })}
                  </button>
                ))}
              </div>
            </fieldset>

            <div>
              <div className="mb-[var(--spacing-8)] flex items-center justify-between">
                <label
                  htmlFor="composer-note"
                  className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]"
                >
                  Note (optional)
                </label>
                <span className="numeric text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                  {note.length}/{NOTE_MAX_LENGTH}
                </span>
              </div>
              <textarea
                id="composer-note"
                value={note}
                maxLength={NOTE_MAX_LENGTH}
                onChange={(event) => setNote(event.target.value)}
                rows={4}
                className="w-full rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
              />
            </div>

            {/* design.md §14.10: "quota display is always visible."
                There's no endpoint to read quota without consuming it
                (checkDailyQuota's own Redis INCR side effect) — shown
                honestly only once a real response in this session has
                revealed it, never guessed at beforehand. */}
            <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
              {quota
                ? `${quota.limit - quota.used} of ${quota.limit} requests left today`
                : "Sending uses one of today's connection requests."}
            </p>

            {error && (
              <div
                role="alert"
                className="rounded-[var(--radius-cards)] p-[var(--spacing-16)]"
                style={{ backgroundColor: "var(--color-danger-tint)" }}
              >
                {isPaywall && quota ? (
                  // PRD §13 F11 trigger 1's exact wording pattern: "You've
                  // used 8 of 8 today. Premium gives you 30." — never the
                  // server's own generic "you've reached today's request
                  // limit" message alone.
                  <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]">
                    You&apos;ve used {quota.used} of {quota.limit} requests today. Premium gives you
                    30.
                  </p>
                ) : (
                  <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]">
                    {error}
                  </p>
                )}
                {isPaywall && (
                  <Link
                    href={`/premium?reason=daily_request_limit&return_to=${encodeURIComponent(pathname)}`}
                    className="mt-[var(--spacing-8)] inline-block text-[length:var(--text-body-sm)] font-medium text-[color:var(--color-danger-text)] underline"
                  >
                    Upgrade for more requests per day
                  </Link>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="min-h-11 w-full rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-8 py-3 text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)] disabled:opacity-50"
            >
              {isSubmitting ? "Sending…" : "Send request"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
