"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import type { EntitlementsResult } from "@/lib/api/client";
import { pushToast } from "@/stores/ui";

const KNOWN_SEARCH_FILTER_LABELS: Record<string, string> = {
  skills: "skills",
  skills_op: "skill matching (AND/OR)",
  min_exp: "years of experience",
  max_exp: "years of experience",
  verified_only: "verified-only",
};

// PRD §13 F11's five triggers, each with its own specific wording — this
// is the one place all five land, so "never a generic upgrade message"
// only needs enforcing here. `entitlements` (when loaded) fills in the
// real current usage numbers; the fallback text still names the specific
// limit even before that request resolves.
function reasonCopy(
  reason: string | null,
  entitlements: EntitlementsResult | undefined,
): string | null {
  if (!reason) return null;
  switch (reason) {
    case "daily_request_limit":
      return entitlements
        ? `You've used ${entitlements.usage.daily_requests_used} of ${entitlements.limits.daily_requests} requests today. Premium gives you 30.`
        : "You've used all your requests today. Premium gives you 30 a day.";
    case "intent_limit":
      return entitlements
        ? `You've reached your ${entitlements.limits.active_intents}-intent limit on the free plan. Premium gives you 8.`
        : "You've reached your intent limit on the free plan. Premium gives you 8.";
    case "who_viewed_me":
      return "See everyone who viewed your profile — free plan only shows the count.";
    case "session_duration":
      return "Sessions longer than 2 hours are a Premium feature.";
    default:
      if (reason in KNOWN_SEARCH_FILTER_LABELS)
        return `Filtering by ${KNOWN_SEARCH_FILTER_LABELS[reason]} is a Premium feature.`;
      return null;
  }
}

function sanitizeReturnTo(returnTo: string | null): string | null {
  if (!returnTo) return null;
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) return null;
  return returnTo;
}

const COMPARISON_ROWS: { label: string; free: string; premium: string }[] = [
  { label: "Requests/day", free: "8", premium: "30" },
  { label: "Active intents", free: "3", premium: "8" },
  { label: "Advanced filters", free: "✕", premium: "✓" },
  { label: "Who viewed you", free: "count", premium: "full list" },
  { label: "Custom radius", free: "✕", premium: "✓" },
  { label: "Session length", free: "up to 120 min", premium: "up to 240 min" },
];

export function PremiumScreen({
  reason,
  returnTo,
}: {
  reason: string | null;
  returnTo: string | null;
}) {
  const [plan, setPlan] = useState<"monthly" | "annual">("monthly");
  const safeReturnTo = sanitizeReturnTo(returnTo);

  const { data: entitlements } = useQuery({
    queryKey: ["entitlements"],
    queryFn: async () => {
      const response = await fetch("/api/entitlements");
      if (!response.ok) throw new Error("Failed to load entitlements");
      return (await response.json()) as EntitlementsResult;
    },
  });

  const copy = reasonCopy(reason, entitlements);
  const alreadyPremium = entitlements ? entitlements.plan !== "free" : false;

  function startTrial() {
    // No payment provider is integrated yet (apps/api's billing module —
    // see entitlements.service.ts's own comment) — this honestly tells
    // the user that rather than faking a successful upgrade and silently
    // returning them to an action that would still fail server-side.
    pushToast({
      variant: "info",
      message: "Billing isn't connected in this environment yet — no payment was processed.",
    });
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-[var(--spacing-24)] px-[var(--spacing-24)] py-[var(--spacing-24)]">
      <div className="flex items-center justify-between">
        <Link
          href={safeReturnTo ?? "/home"}
          aria-label="Close"
          className="min-h-11 min-w-11 content-center text-[length:var(--text-body)] text-[color:var(--color-ink)]"
        >
          ✕
        </Link>
        <h1 className="text-[length:var(--text-body-lg)] font-medium text-[color:var(--color-ink)]">
          Convene Premium
        </h1>
        <span className="w-11" aria-hidden="true" />
      </div>

      {alreadyPremium ? (
        <div className="rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]">
          <p className="text-[length:var(--text-body)] text-[color:var(--color-ink)]">
            You&apos;re already on {entitlements?.plan}.
          </p>
        </div>
      ) : (
        <>
          {copy && (
            <p
              role="status"
              className="text-[length:var(--text-body)] text-[color:var(--color-ink)]"
            >
              {copy}
            </p>
          )}

          <div className="flex gap-[var(--spacing-8)]">
            <button
              type="button"
              onClick={() => setPlan("monthly")}
              aria-pressed={plan === "monthly"}
              className={`min-h-11 flex-1 rounded-[var(--radius-buttons)] border px-[var(--spacing-16)] text-[length:var(--text-body-sm)] ${plan === "monthly" ? "border-[color:var(--color-iris-blue)] bg-[color:var(--color-lavender-wash)] text-[color:var(--color-ink)]" : "border-[color:var(--color-mist-gray)] text-[color:var(--color-ink)]"}`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setPlan("annual")}
              aria-pressed={plan === "annual"}
              className={`min-h-11 flex-1 rounded-[var(--radius-buttons)] border px-[var(--spacing-16)] text-[length:var(--text-body-sm)] ${plan === "annual" ? "border-[color:var(--color-iris-blue)] bg-[color:var(--color-lavender-wash)] text-[color:var(--color-ink)]" : "border-[color:var(--color-mist-gray)] text-[color:var(--color-ink)]"}`}
            >
              Annual −25%
            </button>
          </div>
          <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
            {plan === "monthly" ? "₹399/month" : "₹3,588/year"}
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-[length:var(--text-body-sm)]">
              <thead>
                <tr className="text-left text-[color:var(--color-graphite)]">
                  <th className="py-1">
                    <span className="sr-only">Plan feature</span>
                  </th>
                  <th className="px-2 py-1">Free</th>
                  <th className="px-2 py-1">Premium</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.label} className="border-t border-[color:var(--color-mist-gray)]">
                    <td className="py-2 text-[color:var(--color-ink)]">{row.label}</td>
                    <td className="px-2 text-[color:var(--color-graphite)]">{row.free}</td>
                    <td className="px-2 font-medium text-[color:var(--color-ink)]">
                      {row.premium}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            onClick={startTrial}
            className="min-h-11 rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-8 py-3 text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)]"
          >
            Start 7-day free trial
          </button>
          <p className="text-center text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
            Then ₹399/month. Cancel anytime.
          </p>
        </>
      )}

      {safeReturnTo && (
        <Link
          href={safeReturnTo}
          className="text-center text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)] underline"
        >
          Return to where you were
        </Link>
      )}
    </div>
  );
}
