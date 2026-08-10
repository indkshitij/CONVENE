"use client";

import { cn } from "@convene/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { IntentResponse, IntentTaxonomyEntry, ProfileResponse } from "@/lib/api/client";
import { WizardNav } from "@/components/onboarding/wizard-nav";

// design.md §14.6 step 4 wireframe. Not skippable (§10.1.3: "Required ✓
// (min 1), Skippable ✗") — WizardNav is rendered with no skipHref.
const EXPIRY_OPTIONS = [7, 14, 30, 90] as const;

// §10.4.5's validation table gives exact copy only for one prerequisite
// ("Add your company to use the Hiring intent"); the other three ids
// (verification_level_2/4, experience_years_3) have no PRD-given error
// copy, so their explanations here are written, not transcribed — flagged
// as an assumption. Verification levels can't be evaluated at all yet (no
// verification flow exists anywhere in this codebase through P20.3), so
// those two always render as unmet — an honest reflection of current
// state, not a guess.
const PREREQUISITE_EXPLANATIONS: Record<string, string> = {
  company_on_profile: "Add your company to use the Hiring intent",
  experience_years_3: "Requires 3+ years of experience on your profile",
  verification_level_2: "Requires ID verification (not yet available)",
  verification_level_4: "Requires advanced verification (not yet available)",
};

function isPrerequisiteMet(id: string, profile: ProfileResponse): boolean {
  switch (id) {
    case "company_on_profile":
      return profile.company !== null;
    case "experience_years_3":
      return Number(profile.years_experience ?? "0") >= 3;
    case "verification_level_2":
      return profile.verification.level >= 2;
    case "verification_level_4":
      return profile.verification.level >= 4;
    default:
      // An id this client doesn't recognise isn't grounds to block a
      // selection speculatively — apps/api is the authority and will
      // still reject with 422 INTENT_PREREQUISITE_UNMET if it disagrees.
      return true;
  }
}

interface ApiErrorBody {
  error: { code: string; message: string; details?: { unmet?: string[]; limit?: number } | null };
}

export function IntentsForm({
  profile,
  initialIntents,
  taxonomy,
}: {
  profile: ProfileResponse;
  initialIntents: IntentResponse[];
  taxonomy: IntentTaxonomyEntry[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [activeIntents, setActiveIntents] = useState<IntentResponse[]>(initialIntents);
  const [pendingType, setPendingType] = useState<string | null>(null);
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [openWhyType, setOpenWhyType] = useState<string | null>(null);
  // null = "no selection committed yet this session" — deliberately not 0,
  // so the UI never implies "we checked and found zero" before it actually
  // has. Once populated it echoes apps/api's own createIntent response
  // verbatim (intents.service.ts's own comment: honestly {0,0} until the
  // matching pipeline exists — never estimated here).
  const [matchPreview, setMatchPreview] = useState<{
    potential_matches: number;
    nearby: number;
  } | null>(null);
  const [planLimit, setPlanLimit] = useState<number | null>(null);
  const [upsellMessage, setUpsellMessage] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const activeByType = useMemo(
    () => new Map(activeIntents.map((intent) => [intent.type, intent])),
    [activeIntents],
  );

  const categorised = useMemo(() => {
    const order: string[] = [];
    const byCategory = new Map<string, IntentTaxonomyEntry[]>();
    for (const entry of taxonomy) {
      if (!byCategory.has(entry.category)) {
        byCategory.set(entry.category, []);
        order.push(entry.category);
      }
      byCategory.get(entry.category)!.push(entry);
    }
    return order.map((category) => ({ category, entries: byCategory.get(category)! }));
  }, [taxonomy]);

  async function selectIntent(entry: IntentTaxonomyEntry) {
    setServerError(null);
    setUpsellMessage(null);
    setPendingType(entry.type);
    try {
      const response = await fetch("/api/intents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: entry.type, expires_in_days: 30 }),
      });
      const body = (await response.json()) as
        | {
            intent: IntentResponse;
            active_count: number;
            plan_limit: number;
            match_preview: { potential_matches: number; nearby: number };
          }
        | ApiErrorBody;
      if (!response.ok) {
        const errorBody = body as ApiErrorBody;
        if (errorBody.error.code === "PLAN_LIMIT_REACHED") {
          const limit = errorBody.error.details?.limit;
          setUpsellMessage(
            limit !== undefined
              ? `You've reached your ${limit}-intent limit on the free plan.`
              : "You've reached your intent limit on the free plan.",
          );
          if (limit !== undefined) setPlanLimit(limit);
          return;
        }
        if (errorBody.error.code === "INTENT_PREREQUISITE_UNMET") {
          setServerError("This intent has unmet prerequisites.");
          return;
        }
        setServerError(errorBody.error.message || "Something went wrong. Please try again.");
        return;
      }
      const created = body as {
        intent: IntentResponse;
        active_count: number;
        plan_limit: number;
        match_preview: { potential_matches: number; nearby: number };
      };
      setActiveIntents((current) => [...current, created.intent]);
      setMatchPreview(created.match_preview);
      setPlanLimit(created.plan_limit);
      setExpandedType(entry.type);
    } catch {
      setServerError("Something went wrong. Please try again.");
    } finally {
      setPendingType(null);
    }
  }

  async function deselectIntent(intent: IntentResponse) {
    setServerError(null);
    setPendingType(intent.type);
    try {
      const response = await fetch(`/api/intents/${intent.id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json()) as ApiErrorBody;
        setServerError(body.error.message || "Something went wrong. Please try again.");
        return;
      }
      // apps/api may have promoted a different remaining intent to
      // primary when the removed one was primary (intents.service.ts's
      // deleteIntent) — a resync keeps the "PRIMARY" badge accurate
      // rather than trusting a stale local guess.
      const listResponse = await fetch("/api/intents");
      if (listResponse.ok) {
        setActiveIntents((await listResponse.json()) as IntentResponse[]);
      } else {
        setActiveIntents((current) => current.filter((existing) => existing.id !== intent.id));
      }
      if (expandedType === intent.type) setExpandedType(null);
    } catch {
      setServerError("Something went wrong. Please try again.");
    } finally {
      setPendingType(null);
    }
  }

  async function updateDetail(intent: IntentResponse, detail: string) {
    const response = await fetch(`/api/intents/${intent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ detail: detail.length > 0 ? detail : null }),
    });
    if (response.ok) {
      const updated = (await response.json()) as IntentResponse;
      setActiveIntents((current) =>
        current.map((existing) => (existing.id === updated.id ? updated : existing)),
      );
    }
  }

  async function updateExpiry(intent: IntentResponse, expiresInDays: number) {
    const response = await fetch(`/api/intents/${intent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expires_in_days: expiresInDays }),
    });
    if (response.ok) {
      const updated = (await response.json()) as IntentResponse;
      setActiveIntents((current) =>
        current.map((existing) => (existing.id === updated.id ? updated : existing)),
      );
    }
  }

  async function makePrimary(intent: IntentResponse) {
    const response = await fetch(`/api/intents/${intent.id}/primary`, { method: "POST" });
    if (response.ok) {
      const listResponse = await fetch("/api/intents");
      if (listResponse.ok) setActiveIntents((await listResponse.json()) as IntentResponse[]);
    }
  }

  const canContinue = activeIntents.length >= 1;

  return (
    <div className="flex flex-col gap-[var(--spacing-24)]">
      <div className="flex flex-col gap-[var(--spacing-24)]">
        {categorised.map(({ category, entries }) => (
          <div key={category}>
            <h2 className="mb-[var(--spacing-8)] text-[length:var(--text-caption)] font-medium tracking-wide text-[color:var(--color-graphite)] uppercase">
              {category}
            </h2>
            <div className="grid grid-cols-2 gap-[var(--spacing-8)]">
              {entries.map((entry) => {
                const active = activeByType.get(entry.type);
                const unmet = entry.prerequisites.filter((id) => !isPrerequisiteMet(id, profile));
                const blocked = !active && unmet.length > 0;
                const isPending = pendingType === entry.type;

                return (
                  <div key={entry.type} className="col-span-2 sm:col-span-1">
                    <div className="flex items-center gap-[var(--spacing-8)]">
                      <button
                        type="button"
                        disabled={blocked || isPending}
                        aria-pressed={!!active}
                        onClick={() => (active ? deselectIntent(active) : selectIntent(entry))}
                        className={cn(
                          "min-h-11 flex-1 rounded-[var(--radius-tags)] border px-[var(--spacing-16)] py-[var(--spacing-8)] text-left text-[length:var(--text-body-sm)] font-medium transition-colors",
                          active
                            ? "border-[color:var(--color-iris-blue)] bg-[color:var(--color-lavender-wash)] text-[color:var(--color-ink)]"
                            : blocked
                              ? "border-[color:var(--color-mist-gray)] bg-[color:var(--color-mist-gray)] text-[color:var(--color-graphite)] opacity-60"
                              : "border-[color:var(--color-mist-gray)] text-[color:var(--color-ink)]",
                        )}
                      >
                        {active ? "✓ " : ""}
                        {entry.label}
                        {active?.is_primary ? " ← PRIMARY" : ""}
                      </button>
                      {blocked && (
                        <button
                          type="button"
                          onClick={() =>
                            setOpenWhyType(openWhyType === entry.type ? null : entry.type)
                          }
                          aria-expanded={openWhyType === entry.type}
                          aria-label={`Why is ${entry.label} unavailable?`}
                          className="min-h-11 min-w-11 shrink-0 text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)] underline"
                        >
                          Why?
                        </button>
                      )}
                    </div>
                    {blocked && openWhyType === entry.type && (
                      <p className="mt-[var(--spacing-8)] text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                        {unmet.map((id) => PREREQUISITE_EXPLANATIONS[id] ?? id).join(" · ")}
                      </p>
                    )}
                    {active && expandedType === entry.type && (
                      <div className="mt-[var(--spacing-8)] flex flex-col gap-[var(--spacing-8)] rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]">
                        <label className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                          Add detail (optional)
                          <textarea
                            defaultValue={active.detail ?? ""}
                            maxLength={200}
                            onBlur={(event) => updateDetail(active, event.target.value)}
                            className="mt-[var(--spacing-8)] w-full rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
                            rows={2}
                          />
                        </label>
                        <label className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                          Expires
                          <select
                            value={Math.round(
                              (new Date(active.expires_at).getTime() - Date.now()) /
                                (24 * 60 * 60 * 1000),
                            )}
                            onChange={(event) => updateExpiry(active, Number(event.target.value))}
                            className="mt-[var(--spacing-8)] min-h-11 w-full rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
                          >
                            {EXPIRY_OPTIONS.map((days) => (
                              <option key={days} value={days}>
                                {days} days
                              </option>
                            ))}
                          </select>
                        </label>
                        {!active.is_primary && (
                          <button
                            type="button"
                            onClick={() => makePrimary(active)}
                            className="min-h-11 self-start text-[length:var(--text-caption)] text-[color:var(--color-iris-blue)] underline"
                          >
                            Make primary
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {upsellMessage && (
        <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]">
          {upsellMessage}{" "}
          <Link
            href={`/premium?reason=intent_limit&return_to=${encodeURIComponent(pathname)}`}
            className="underline"
          >
            See Premium
          </Link>
        </p>
      )}
      {serverError && (
        <p
          role="alert"
          className="text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]"
        >
          {serverError}
        </p>
      )}

      <div className="flex flex-col gap-[var(--spacing-8)] border-t border-[color:var(--color-mist-gray)] pt-[var(--spacing-16)]">
        <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
          {activeIntents.length} of {planLimit ?? "—"} selected
        </p>
        <p className="text-[length:var(--text-body-sm)] font-medium text-[color:var(--color-ink)]">
          {matchPreview === null
            ? "Select an intent to see potential matches"
            : `✦ ${matchPreview.potential_matches} potential matches`}
        </p>
      </div>

      <button
        type="button"
        disabled={!canContinue}
        onClick={() => router.push("/setup/5")}
        className="min-h-11 w-full rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-8 py-3 text-[length:var(--text-body)] text-[color:var(--color-paper-white)] disabled:opacity-50"
      >
        Continue
      </button>

      <WizardNav backHref="/setup/3" />
    </div>
  );
}
