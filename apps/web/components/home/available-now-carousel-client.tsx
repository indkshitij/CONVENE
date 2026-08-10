"use client";

import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { qk } from "@/lib/api/query-keys";
import type { HydratedDiscoveryResponse } from "@/lib/api/client";
import { discoveryEmptyStateCopy } from "@/lib/discovery/empty-state-copy";
import { SectionError } from "./section-error";

const SCORE_DISPLAY_FLOOR = 40; // design.md (P22.1's card spec): "score chip ... hidden below 40."

async function fetchAvailableNow(): Promise<HydratedDiscoveryResponse> {
  const response = await fetch("/api/discover/available-now");
  if (!response.ok) throw new Error("Failed to load available-now feed");
  return (await response.json()) as HydratedDiscoveryResponse;
}

export function AvailableNowCarouselClient({
  initialData,
}: {
  initialData: HydratedDiscoveryResponse;
}) {
  const { data, isError, refetch } = useQuery({
    queryKey: qk.feed.discover({ surface: "available_now" }),
    queryFn: fetchAvailableNow,
    initialData,
  });

  if (isError)
    return (
      <SectionError message="Couldn't load who's available now." onRetry={() => void refetch()} />
    );

  return (
    <section aria-labelledby="available-now-heading">
      <div className="mb-[var(--spacing-8)] flex items-center justify-between">
        <h2
          id="available-now-heading"
          className="text-[length:var(--text-body)] font-medium text-[color:var(--color-ink)]"
        >
          Available now near you
        </h2>
        <Link
          href="/discover?tab=nearby"
          className="text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)] underline"
        >
          See all
        </Link>
      </div>

      {data.data.length === 0 ? (
        <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
          {discoveryEmptyStateCopy(data.empty_state ?? "no_supply", "available_now")}
        </p>
      ) : (
        <div className="flex gap-[var(--spacing-16)] overflow-x-auto">
          {data.data.map((match) => (
            <Link
              key={match.candidate_id}
              href={`/match/${match.candidate_id}`}
              className="flex w-32 shrink-0 flex-col gap-[var(--spacing-8)] rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-8)]"
            >
              <div className="flex items-center gap-[var(--spacing-8)]">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: "var(--availability-available-now)" }}
                />
                {match.profile?.avatar ? (
                  <Image
                    src={match.profile.avatar.sm}
                    alt=""
                    width={40}
                    height={40}
                    className="h-10 w-10 rounded-full object-cover"
                    unoptimized
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--color-mist-gray)] text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]"
                  >
                    {(match.profile?.full_name ?? "?").charAt(0)}
                  </span>
                )}
              </div>
              <p className="truncate text-[length:var(--text-body-sm)] font-medium text-[color:var(--color-ink)]">
                {match.profile?.full_name ?? "Member"}
              </p>
              {match.profile?.headline && (
                <p className="truncate text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                  {match.profile.headline}
                </p>
              )}
              {match.profile?.distance_bucket && (
                <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                  {match.profile.distance_bucket}
                </p>
              )}
              {match.score >= SCORE_DISPLAY_FLOOR && (
                <p className="numeric text-[length:var(--text-caption)] font-semibold text-[color:var(--color-ink)]">
                  ✦ {match.score}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
