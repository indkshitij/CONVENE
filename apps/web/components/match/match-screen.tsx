"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { computeCountdown, formatCountdown } from "@/lib/availability/countdown";
import { pushToast } from "@/stores/ui";
import { RequestComposer } from "@/components/composer/request-composer";
import type {
  CandidateDisplayProfile,
  IntentResponse,
  IntentTaxonomyEntry,
  ScoreExplanation,
  SessionResponse,
} from "@/lib/api/client";

// design.md §14.9: "Purpose: a focused, one-at-a-time review surface
// shown immediately after going available. Explicitly not a
// swipe-for-attraction UX — actions are labelled buttons, the card is
// information-dense, and there is no gesture that implies judging a
// person." Every string on this screen is written with that in mind —
// see tests/e2e/../copy-audit for the automated check.
const SUB_SCORE_LABELS: Record<string, string> = {
  avail: "Availability",
  intent: "Intent",
  loc: "Location",
  skill: "Skills",
  industry: "Industry",
  exp: "Experience",
  interest: "Interests",
  mutual: "Mutual connections",
  activity: "Activity",
  rep: "Reputation",
  lang: "Languages",
};

const SKIP_REASONS = ["Not relevant", "Wrong intent", "Too senior/junior", "Too far"] as const;
const CONNECT_AUTO_ADVANCE_MS = 800;
const UNDO_WINDOW_MS = 5000;

interface CandidateState {
  id: string;
  profile: CandidateDisplayProfile | null;
  explanation: ScoreExplanation | null;
}

export function MatchScreen({
  initialCandidateId,
  initialProfile,
  initialExplanation,
  stackIds,
  currentSession,
  ownIntents,
  taxonomy,
}: {
  initialCandidateId: string;
  initialProfile: CandidateDisplayProfile | null;
  initialExplanation: ScoreExplanation | null;
  stackIds: string[];
  currentSession: SessionResponse | null;
  ownIntents: IntentResponse[];
  taxonomy: IntentTaxonomyEntry[];
}) {
  const [candidate, setCandidate] = useState<CandidateState>({
    id: initialCandidateId,
    profile: initialProfile,
    explanation: initialExplanation,
  });
  const [isLoadingCandidate, setIsLoadingCandidate] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const previousCandidateRef = useRef<CandidateState | null>(null);

  const position = stackIds.indexOf(candidate.id);
  const total = stackIds.length;

  async function advanceToNext() {
    const index = stackIds.indexOf(candidate.id);
    const nextId = index >= 0 ? stackIds[index + 1] : undefined;
    if (!nextId) {
      setExhausted(true);
      return;
    }
    setIsLoadingCandidate(true);
    setShowBreakdown(false);
    setComposerOpen(false);
    try {
      const response = await fetch(`/api/match-candidate/${nextId}`);
      if (response.ok) {
        const data = (await response.json()) as {
          profile: CandidateDisplayProfile | null;
          explanation: ScoreExplanation | null;
        };
        setCandidate({ id: nextId, profile: data.profile, explanation: data.explanation });
      }
    } finally {
      setIsLoadingCandidate(false);
    }
  }

  // design.md §14.9's own implementation note: "Skip is optimistic with a
  // 5s undo toast." There's no "unskip" endpoint (same real constraint
  // P22.1's card-grid skip hit) — the actual POST /matches/:id/skip call
  // is delayed until the undo window closes, and Undo just restores the
  // snapshot taken before advancing (no network round trip needed since
  // nothing was ever committed yet).
  function handleSkip(reason?: string) {
    const snapshot = candidate;
    previousCandidateRef.current = snapshot;
    const timer = setTimeout(() => {
      void fetch(`/api/matches/${snapshot.id}/skip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reason ? { reason } : {}),
      });
    }, UNDO_WINDOW_MS);

    pushToast({
      variant: "info",
      message: "Skipped",
      durationMs: UNDO_WINDOW_MS,
      action: {
        label: "Undo",
        onClick: () => {
          clearTimeout(timer);
          if (previousCandidateRef.current?.id === snapshot.id) {
            setCandidate(snapshot);
            setExhausted(false);
          }
        },
      },
    });

    void advanceToNext();
  }

  const sessionCountdown =
    currentSession?.state === "available_now" && currentSession.expires_at
      ? computeCountdown(currentSession.expires_at)
      : null;
  const profile = candidate.profile;

  if (exhausted) {
    return (
      <div className="flex flex-col items-center gap-[var(--spacing-16)] px-[var(--spacing-24)] py-[var(--spacing-40)] text-center">
        <h1 className="text-[length:var(--text-heading-sm)] font-[family-name:var(--font-aeonik)] text-[color:var(--color-ink)]">
          You&apos;ve seen everyone available
        </h1>
        <p className="text-[length:var(--text-body)] text-[color:var(--color-graphite)]">
          Widen your radius or check back later — new people go available throughout the day.
        </p>
        <a
          href="/discover"
          className="min-h-11 rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-8 py-3 text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)]"
        >
          Browse discover
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-16)] px-[var(--spacing-24)] py-[var(--spacing-24)]">
      <header className="flex items-center justify-between">
        <h1 className="text-[length:var(--text-body)] font-medium text-[color:var(--color-ink)]">
          {sessionCountdown
            ? `Available for ${formatCountdown(sessionCountdown.remainingMs)}`
            : "Discover"}
        </h1>
        {total > 0 && position >= 0 && (
          <span className="numeric text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
            {position + 1}/{total}
          </span>
        )}
      </header>

      {isLoadingCandidate ? (
        <div className="h-96 w-full animate-pulse rounded-[var(--radius-cards)] bg-[color:var(--color-mist-gray)]" />
      ) : (
        // design.md §14.9: "Photo is never the dominant element; the
        // headline and intents lead." The avatar below is deliberately
        // the same modest size used elsewhere in this app (match-card.tsx),
        // not an enlarged hero image, and sits beside — not above — the
        // name/headline text it accompanies.
        // touch-action: pan-y actively disables horizontal panning at the
        // browser/OS level (vertical scroll still works) — combined with
        // never attaching any drag/swipe handler at all, this is a real
        // disabling mechanism, not simply an absent feature.
        <div
          style={{ touchAction: "pan-y" }}
          className="flex flex-col gap-[var(--spacing-16)] rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-24)]"
        >
          <div className="flex items-start gap-[var(--spacing-16)]">
            {profile?.avatar ? (
              <Image
                src={profile.avatar.md}
                alt=""
                width={56}
                height={56}
                className="h-14 w-14 shrink-0 rounded-full object-cover"
                unoptimized
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-mist-gray)] text-[length:var(--text-body)] text-[color:var(--color-graphite)]"
              >
                {(profile?.full_name ?? "?").charAt(0)}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[length:var(--text-body-lg)] font-medium text-[color:var(--color-ink)]">
                {profile?.full_name ?? "Member"}
              </p>
              {profile?.headline && (
                <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
                  {profile.headline}
                </p>
              )}
              {profile?.company && (
                <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                  {profile.company.name}
                  {profile.company.verified && " ✔"}
                </p>
              )}
              <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                {[profile?.distance_bucket, profile?.city].filter(Boolean).join(" · ") ||
                  "Location unknown"}
              </p>
              {profile?.primary_intent_type && (
                <span className="mt-[var(--spacing-8)] inline-block rounded-[var(--radius-tags)] bg-[color:var(--color-lavender-wash)] px-3 py-1 text-[length:var(--text-caption)] text-[color:var(--color-ink)]">
                  {profile.primary_intent_type
                    .split("_")
                    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(" ")}
                </span>
              )}
            </div>
          </div>

          {candidate.explanation && (
            <div>
              <button
                type="button"
                onClick={() => setShowBreakdown((open) => !open)}
                aria-expanded={showBreakdown}
                className="flex min-h-11 w-full items-center justify-between text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
              >
                <span className="numeric font-semibold">
                  ✦ {candidate.explanation.score}% compatible
                </span>
                <span className="text-[color:var(--color-iris-blue)] underline">
                  Why? {showBreakdown ? "▴" : "▾"}
                </span>
              </button>
              {showBreakdown && (
                <div className="mt-[var(--spacing-8)] flex flex-col gap-[var(--spacing-8)] rounded-[var(--radius-cards)] bg-[color:var(--color-mist-gray)] p-[var(--spacing-16)]">
                  {candidate.explanation.contributions.map((contribution) => {
                    const percent = Math.round(contribution.subScore * 100);
                    return (
                      <div key={contribution.key}>
                        <div className="flex items-center justify-between text-[length:var(--text-caption)] text-[color:var(--color-ink)]">
                          <span>{SUB_SCORE_LABELS[contribution.key] ?? contribution.key}</span>
                          <span className="numeric">{percent}%</span>
                        </div>
                        <div className="mt-1 h-2 w-full rounded-[var(--radius-tags)] bg-[color:var(--color-paper-white)]">
                          <div
                            className="h-full rounded-[var(--radius-tags)]"
                            style={{
                              width: `${percent}%`,
                              backgroundColor: "var(--color-iris-blue)",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <fieldset>
            <legend className="mb-[var(--spacing-8)] text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
              Skip reason (optional)
            </legend>
            <div className="flex flex-wrap gap-[var(--spacing-8)]">
              {SKIP_REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => handleSkip(reason)}
                  className="min-h-11 rounded-[var(--radius-tags)] border border-[color:var(--color-mist-gray)] px-3 py-1 text-[length:var(--text-caption)] text-[color:var(--color-ink)]"
                >
                  {reason}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex gap-[var(--spacing-8)]">
            <button
              type="button"
              onClick={() => handleSkip()}
              className="min-h-11 flex-1 rounded-[var(--radius-buttons)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={() => setComposerOpen(true)}
              className="min-h-11 flex-1 rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)]"
            >
              Connect
            </button>
          </div>
          <a
            href={`/profile/${candidate.id}`}
            className="text-center text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)] underline"
          >
            View full profile
          </a>
        </div>
      )}

      {composerOpen && profile && (
        <RequestComposer
          recipientId={candidate.id}
          recipientName={profile.full_name}
          recipientHeadline={profile.headline}
          recipientAvailability={profile.availability}
          ownIntents={ownIntents}
          taxonomy={taxonomy}
          recipientPrimaryIntentType={profile.primary_intent_type}
          matchScore={candidate.explanation?.score}
          onClose={() => setComposerOpen(false)}
          onSent={() => setTimeout(() => void advanceToNext(), CONNECT_AUTO_ADVANCE_MS)}
        />
      )}
    </div>
  );
}
