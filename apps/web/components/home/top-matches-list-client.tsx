"use client";

import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { qk } from "@/lib/api/query-keys";
import type { HydratedDiscoveryResponse } from "@/lib/api/client";
import { discoveryEmptyStateCopy } from "@/lib/discovery/empty-state-copy";
import { SectionError } from "./section-error";

const SCORE_DISPLAY_FLOOR = 40;
const MAX_SHOWN = 5; // design.md §14.7: "vertical list (5)."

async function fetchTopMatches(): Promise<HydratedDiscoveryResponse> {
  const response = await fetch("/api/discover?tab=nearby");
  if (!response.ok) throw new Error("Failed to load top matches");
  return (await response.json()) as HydratedDiscoveryResponse;
}

// "Connect"/"Not interested" (design.md's wireframe buttons) aren't built
// here — Connect needs intent selection + the AI icebreaker composer
// (P22.3's own scope) and skip is one of the project's four sanctioned
// optimistic mutations, owned by the match screen (P22.2), not this
// browsing list. Each card instead links to /match/:userId, matching
// P19.1's already-scaffolded route for exactly that screen.
export function TopMatchesListClient({ initialData }: { initialData: HydratedDiscoveryResponse }) {
  const { data, isError, refetch } = useQuery({
    queryKey: qk.feed.discover({ surface: "discover", tab: "nearby" }),
    queryFn: fetchTopMatches,
    initialData,
  });

  if (isError)
    return (
      <SectionError message="Couldn't load your top matches." onRetry={() => void refetch()} />
    );

  const matches = data.data.slice(0, MAX_SHOWN);

  return (
    <section aria-labelledby="top-matches-heading">
      <h2
        id="top-matches-heading"
        className="mb-[var(--spacing-8)] text-[length:var(--text-body)] font-medium text-[color:var(--color-ink)]"
      >
        Top matches
      </h2>

      {matches.length === 0 ? (
        <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
          {discoveryEmptyStateCopy(data.empty_state ?? "no_supply", "top_matches")}
        </p>
      ) : (
        <div className="flex flex-col gap-[var(--spacing-8)]">
          {matches.map((match) => (
            <Link
              key={match.candidate_id}
              href={`/match/${match.candidate_id}`}
              className="flex items-center gap-[var(--spacing-16)] rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]"
            >
              {match.profile?.avatar ? (
                <Image
                  src={match.profile.avatar.sm}
                  alt=""
                  width={48}
                  height={48}
                  className="h-12 w-12 shrink-0 rounded-full object-cover"
                  unoptimized
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-mist-gray)] text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]"
                >
                  {(match.profile?.full_name ?? "?").charAt(0)}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[length:var(--text-body-sm)] font-medium text-[color:var(--color-ink)]">
                  {match.profile?.full_name ?? "Member"}
                </p>
                {match.profile?.headline && (
                  <p className="truncate text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                    {match.profile.headline}
                  </p>
                )}
                <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                  {match.profile?.distance_bucket ?? "Distance unknown"}
                  {match.reasons.length > 0 ? ` · ${match.reasons.join(" · ")}` : ""}
                </p>
              </div>
              {match.score >= SCORE_DISPLAY_FLOOR && (
                <span className="numeric shrink-0 text-[length:var(--text-body-sm)] font-semibold text-[color:var(--color-ink)]">
                  ✦ {match.score}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
