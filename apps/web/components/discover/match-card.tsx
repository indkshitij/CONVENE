"use client";

import { scoreBand } from "@convene/matching";
import { availability as availabilityTokens } from "@convene/tokens";
import Image from "next/image";
import Link from "next/link";
import { memo, useEffect, useRef, useState } from "react";
import { computeCountdown } from "@/lib/availability/countdown";
import type { HydratedMatchCard } from "@/lib/api/client";

// design.md §14.8: "Card anatomy (the most important component in the
// product): avatar with an availability ring · name + verification badge
// · headline (2 lines max) · company with verified tick · distance
// bucket + city · compatibility score chip · up to 3 match-reason chips
// · primary-intent chip · presence/countdown · actions Connect and ⋯
// (Not interested, Share, Report)."
const SCORE_DISPLAY_FLOOR = 40; // "hidden below 40."
const MAX_REASON_CHIPS = 3;
// L2 verification is this codebase's own established "meaningfully
// verified" threshold (intent-taxonomy.ts's need_cofounder prerequisite)
// — reused here for the badge since design.md doesn't name an exact
// level for this specific badge.
const VERIFIED_BADGE_LEVEL = 2;

function scoreChipColor(band: ReturnType<typeof scoreBand>): string {
  switch (band) {
    case "85-100":
      return "var(--availability-available-now)";
    case "70-84":
      return "var(--color-iris-blue)";
    case "55-69":
      return "var(--availability-busy)";
    default:
      return "var(--color-graphite)";
  }
}

function humanizeIntentType(type: string): string {
  return type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export interface MatchCardProps {
  match: HydratedMatchCard;
  onSkip: (candidateId: string) => void;
  onShare: (candidateId: string) => void;
  onReport: (candidateId: string) => void;
}

function MatchCardImpl({ match, onSkip, onShare, onReport }: MatchCardProps) {
  const profile = match.profile;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const band = scoreBand(match.score);
  const isAvailableNow = profile?.availability?.state === "available_now";
  const countdown =
    isAvailableNow && profile?.availability?.expires_at
      ? computeCountdown(profile.availability.expires_at)
      : null;

  return (
    <article className="flex flex-col gap-[var(--spacing-16)] rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]">
      <div className="flex items-start gap-[var(--spacing-16)]">
        <span
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2"
          style={{
            borderColor: isAvailableNow ? "var(--availability-available-now)" : "transparent",
          }}
        >
          {profile?.avatar ? (
            <Image
              src={profile.avatar.md}
              alt=""
              width={52}
              height={52}
              className="h-13 w-13 rounded-full object-cover"
              unoptimized
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-13 w-13 items-center justify-center rounded-full bg-[color:var(--color-mist-gray)] text-[length:var(--text-body)] text-[color:var(--color-graphite)]"
            >
              {(profile?.full_name ?? "?").charAt(0)}
            </span>
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-[var(--spacing-8)]">
            <Link
              href={`/match/${match.candidate_id}`}
              className="truncate text-[length:var(--text-body)] font-medium text-[color:var(--color-ink)]"
            >
              {profile?.full_name ?? "Member"}
            </Link>
            {(profile?.verification_level ?? 0) >= VERIFIED_BADGE_LEVEL && (
              <span
                aria-label="Verified"
                title="Verified"
                className="text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)]"
              >
                ✔
              </span>
            )}
          </div>
          {profile?.headline && (
            <p className="line-clamp-2 text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
              {profile.headline}
            </p>
          )}
          {profile?.company && (
            <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
              {profile.company.name}
              {profile.company.verified && <span aria-label="Verified employer"> ✔</span>}
            </p>
          )}
          <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
            {[profile?.distance_bucket, profile?.city].filter(Boolean).join(" · ") ||
              "Location unknown"}
          </p>
        </div>

        {match.score >= SCORE_DISPLAY_FLOOR && (
          <span
            className="numeric shrink-0 rounded-[var(--radius-tags)] px-[var(--spacing-8)] py-1 text-[length:var(--text-body-sm)] font-semibold text-[color:var(--color-paper-white)]"
            style={{ backgroundColor: scoreChipColor(band) }}
          >
            ✦ {match.score}
          </span>
        )}
      </div>

      {countdown && (
        <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
          <span aria-hidden="true" style={{ color: "var(--availability-available-now)" }}>
            ●
          </span>{" "}
          {availabilityTokens.availableNow.label} ·{" "}
          {Math.max(1, Math.ceil(countdown.remainingMs / 60_000))} min left
        </p>
      )}

      {match.reasons.length > 0 && (
        <div className="flex flex-wrap gap-[var(--spacing-8)]">
          {match.reasons.slice(0, MAX_REASON_CHIPS).map((reason) => (
            <span
              key={reason}
              className="rounded-[var(--radius-tags)] bg-[color:var(--color-mint-wash)] px-3 py-1 text-[length:var(--text-caption)] text-[color:var(--color-ink)]"
            >
              ✓ {reason}
            </span>
          ))}
        </div>
      )}

      {profile?.primary_intent_type && (
        <span className="w-fit rounded-[var(--radius-tags)] bg-[color:var(--color-lavender-wash)] px-3 py-1 text-[length:var(--text-caption)] text-[color:var(--color-ink)]">
          {humanizeIntentType(profile.primary_intent_type)}
        </span>
      )}

      <div className="flex items-center gap-[var(--spacing-8)]">
        <Link
          href={`/match/${match.candidate_id}`}
          className="min-h-11 flex-1 rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-8 py-3 text-center text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)]"
        >
          Connect
        </Link>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="More actions"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-buttons)] border border-[color:var(--color-mist-gray)] text-[length:var(--text-body)] text-[color:var(--color-ink)]"
          >
            ⋯
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-10 mt-[var(--spacing-8)] flex w-40 flex-col rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] bg-[color:var(--color-paper-white)] p-[var(--spacing-8)] shadow-[var(--shadow-lg)]"
            >
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onSkip(match.candidate_id);
                }}
                className="min-h-11 rounded-[var(--radius-inputs)] px-[var(--spacing-16)] text-left text-[length:var(--text-body-sm)] text-[color:var(--color-ink)] hover:bg-[color:var(--color-mist-gray)]"
              >
                Not interested
              </button>
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onShare(match.candidate_id);
                }}
                className="min-h-11 rounded-[var(--radius-inputs)] px-[var(--spacing-16)] text-left text-[length:var(--text-body-sm)] text-[color:var(--color-ink)] hover:bg-[color:var(--color-mist-gray)]"
              >
                Share
              </button>
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onReport(match.candidate_id);
                }}
                className="min-h-11 rounded-[var(--radius-inputs)] px-[var(--spacing-16)] text-left text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)] hover:bg-[color:var(--color-mist-gray)]"
              >
                Report
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

// design.md's own implementation note: "React.memo with stable callbacks
// (this component re-renders most)." The parent feed (discover/page.tsx)
// is responsible for the "stable" half — useCallback-wrapped
// onSkip/onShare/onReport — this only handles the memo half.
export const MatchCard = memo(MatchCardImpl);
