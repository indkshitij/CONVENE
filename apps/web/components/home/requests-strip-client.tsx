"use client";

import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { qk } from "@/lib/api/query-keys";
import type { HydratedRequestsListResponse } from "@/lib/api/client";
import { SectionError } from "./section-error";

const MAX_SHOWN = 5; // design.md §14.7: "horizontal, max 5, ranked."

async function fetchRequests(): Promise<HydratedRequestsListResponse> {
  const response = await fetch(
    "/api/connections/requests?direction=received&status=pending&sort=score_desc",
  );
  if (!response.ok) throw new Error("Failed to load requests");
  return (await response.json()) as HydratedRequestsListResponse;
}

export function RequestsStripClient({
  initialData,
}: {
  initialData: HydratedRequestsListResponse;
}) {
  const { data, isError, refetch } = useQuery({
    queryKey: qk.requests.list("received", "pending", "score_desc"),
    queryFn: fetchRequests,
    initialData,
  });

  if (isError)
    return <SectionError message="Couldn't load your requests." onRetry={() => void refetch()} />;

  const requests = data.requests.slice(0, MAX_SHOWN);

  return (
    <section aria-labelledby="requests-strip-heading">
      <div className="mb-[var(--spacing-8)] flex items-center justify-between">
        <h2
          id="requests-strip-heading"
          className="text-[length:var(--text-body)] font-medium text-[color:var(--color-ink)]"
        >
          Requests ({data.requests.length})
        </h2>
        <Link
          href="/requests"
          className="text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)] underline"
        >
          See all
        </Link>
      </div>

      {requests.length === 0 ? (
        <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
          No pending requests yet.
        </p>
      ) : (
        <div className="flex gap-[var(--spacing-16)] overflow-x-auto">
          {requests.map((request) => (
            <Link
              key={request.id}
              href="/requests"
              className="flex min-h-11 w-16 shrink-0 flex-col items-center gap-[var(--spacing-8)]"
            >
              {request.counterparty?.avatar ? (
                <Image
                  src={request.counterparty.avatar.sm}
                  alt=""
                  width={48}
                  height={48}
                  className="h-12 w-12 rounded-full object-cover"
                  unoptimized
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--color-mist-gray)] text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]"
                >
                  {(request.counterparty?.full_name ?? "?").charAt(0)}
                </span>
              )}
              <span className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                {request.counterparty?.full_name ?? "Member"}
              </span>
              {request.match_score !== null && (
                <span className="numeric text-[length:var(--text-caption)] font-semibold text-[color:var(--color-ink)]">
                  {request.match_score}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
