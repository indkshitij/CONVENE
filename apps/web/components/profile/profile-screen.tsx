"use client";

import { availability as availabilityTokens } from "@convene/tokens";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { computeCountdown, formatCountdown } from "@/lib/availability/countdown";
import type {
  CompletionResult,
  EntitlementsResult,
  FullProfileResponse,
  ProfileViewersResult,
} from "@/lib/api/client";
import { ReportModal } from "@/components/discover/report-modal";
import { pushToast } from "@/stores/ui";

const VERIFIED_BADGE_LEVEL = 2;

// apps/api's availability.state is snake_case ("available_now"); the
// availability tokens object is keyed camelCase (see availability-card.tsx's
// own `availabilityTokens.availableNow` usage) — this reconciles the two
// rather than indexing one naming convention with the other's keys.
const AVAILABILITY_STATE_TOKEN: Record<string, keyof typeof availabilityTokens> = {
  available_now: "availableNow",
  busy: "busy",
  away: "away",
  scheduled: "scheduled",
  offline: "offline",
};

function humanize(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDateRange(start: string, end: string | null, isCurrent: boolean): string {
  const startLabel = new Date(start).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
  });
  const endLabel = isCurrent
    ? "Present"
    : end
      ? new Date(end).toLocaleDateString(undefined, { year: "numeric", month: "short" })
      : "";
  return `${startLabel} – ${endLabel}`;
}

export function ProfileScreen({
  profile,
  completion,
  isSelf,
}: {
  profile: FullProfileResponse;
  completion: CompletionResult | null;
  isSelf: boolean;
}) {
  const [aboutExpanded, setAboutExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const isAvailableNow = profile.availability?.state === "available_now";
  const countdown =
    isAvailableNow && profile.availability?.expires_at
      ? computeCountdown(profile.availability.expires_at)
      : null;
  const canRequest = !isSelf && profile.relationship.can_request;
  const isConnected =
    profile.relationship.status === "connected" || profile.relationship.status === "matched";

  async function onBlock() {
    setMenuOpen(false);
    const response = await fetch("/api/blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: profile.user_id }),
    });
    if (response.ok)
      pushToast({
        variant: "success",
        message: "Blocked. You won't see each other anymore.",
        durationMs: 4000,
      });
    else pushToast({ variant: "error", message: "Couldn't block this profile. Please try again." });
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-[var(--spacing-24)] px-[var(--spacing-24)] py-[var(--spacing-24)]">
      <div className="flex items-center justify-between">
        <Link
          href="/home"
          aria-label="Back"
          className="min-h-11 min-w-11 content-center text-[length:var(--text-body)] text-[color:var(--color-ink)]"
        >
          ←
        </Link>
        {!isSelf && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Profile actions"
              className="min-h-11 min-w-11 text-[color:var(--color-graphite)]"
            >
              ⋯
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-11 z-10 flex flex-col rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] bg-[color:var(--color-paper-white)] py-[var(--spacing-8)] shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setReportOpen(true);
                  }}
                  className="min-h-11 px-[var(--spacing-16)] text-left text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
                >
                  Report
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void onBlock()}
                  className="min-h-11 px-[var(--spacing-16)] text-left text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]"
                >
                  Block
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-[var(--spacing-8)] text-center">
        <span
          className="relative flex h-20 w-20 items-center justify-center rounded-full border-2"
          style={{
            borderColor: isAvailableNow ? "var(--availability-available-now)" : "transparent",
          }}
        >
          {profile.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element -- avatar is a remote signed URL, not a static-optimizable local asset
            <img
              src={profile.avatar.lg}
              alt=""
              className="h-[72px] w-[72px] rounded-full object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[color:var(--color-lavender-wash)] text-[length:var(--text-heading-sm)] text-[color:var(--color-ink)]"
            >
              {profile.full_name.charAt(0)}
            </span>
          )}
        </span>

        <div className="flex items-center gap-1">
          <h1 className="text-[length:var(--text-subheading)] font-[family-name:var(--font-aeonik)] text-[color:var(--color-ink)]">
            {profile.full_name}
          </h1>
          {profile.verification.level >= VERIFIED_BADGE_LEVEL && (
            <span
              aria-label="ID Verified"
              title="ID Verified"
              className="text-[color:var(--color-iris-blue)]"
            >
              ✔
            </span>
          )}
        </div>
        {profile.job_title && (
          <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
            {profile.job_title}
          </p>
        )}
        <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
          {[profile.company?.name, profile.location.city, profile.location.distance_bucket]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
          {humanize(profile.reputation.band)} · replies {profile.reputation.response_rate ?? "—"}
        </p>

        {profile.availability && (
          <div
            className="w-full rounded-[var(--radius-cards)] p-[var(--spacing-16)]"
            style={{
              backgroundColor: isAvailableNow ? "var(--color-mint-wash)" : "var(--color-mist-gray)",
            }}
          >
            <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
              {(() => {
                const tokenKey = AVAILABILITY_STATE_TOKEN[profile.availability.state];
                const token = tokenKey ? availabilityTokens[tokenKey] : null;
                return token && "label" in token
                  ? token.label
                  : humanize(profile.availability.state);
              })()}
              {countdown && !countdown.isExpired && ` · ${formatCountdown(countdown.remainingMs)}`}
            </p>
          </div>
        )}

        <div className="flex w-full gap-[var(--spacing-8)]">
          {isSelf ? (
            <Link
              href="/profile/edit"
              className="min-h-11 flex-1 content-center rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] text-center text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)]"
            >
              Edit profile
            </Link>
          ) : (
            <>
              {canRequest && (
                <Link
                  href={`/match/${profile.user_id}`}
                  className="min-h-11 flex-1 content-center rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] text-center text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)]"
                >
                  Connect
                </Link>
              )}
              {isConnected && (
                <Link
                  href="/chats"
                  aria-label="Message"
                  className="min-h-11 min-w-11 content-center rounded-[var(--radius-buttons)] border border-[color:var(--color-mist-gray)] text-center text-[length:var(--text-body)]"
                >
                  💬
                </Link>
              )}
            </>
          )}
        </div>
      </div>

      {isSelf && completion && completion.score < 100 && (
        <div className="rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]">
          <p className="numeric text-[length:var(--text-body-sm)] font-semibold text-[color:var(--color-ink)]">
            {completion.score}% complete
          </p>
          {completion.missing[0] && (
            <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
              Next: {completion.missing[0].cta} (+{completion.missing[0].impact}%)
            </p>
          )}
        </div>
      )}

      {isSelf && <WhoViewedMeRow />}

      {profile.intents.length > 0 && (
        <Section title="Looking for">
          <div className="flex flex-wrap gap-[var(--spacing-8)]">
            {profile.intents.map((intent) => (
              <span
                key={intent.type}
                className="rounded-[var(--radius-tags)] bg-[color:var(--color-lavender-wash)] px-3 py-1 text-[length:var(--text-caption)] text-[color:var(--color-ink)]"
              >
                🎯 {humanize(intent.type)}
              </span>
            ))}
          </div>
          {profile.intents[0]?.detail && (
            <p className="mt-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
              &quot;{profile.intents[0].detail}&quot;
            </p>
          )}
        </Section>
      )}

      <SectionOrEmpty
        title="About"
        isSelf={isSelf}
        hasContent={Boolean(profile.about)}
        emptyCta="Add a summary about yourself"
      >
        {profile.about && (
          <div>
            <p
              className={
                aboutExpanded
                  ? "text-[length:var(--text-body)] text-[color:var(--color-ink)]"
                  : "line-clamp-3 text-[length:var(--text-body)] text-[color:var(--color-ink)]"
              }
            >
              {profile.about}
            </p>
            {profile.about.length > 160 && (
              <button
                type="button"
                onClick={() => setAboutExpanded((expanded) => !expanded)}
                className="min-h-11 text-[length:var(--text-caption)] text-[color:var(--color-iris-blue)] underline"
              >
                {aboutExpanded ? "less" : "more"} ▾
              </button>
            )}
          </div>
        )}
      </SectionOrEmpty>

      <SectionOrEmpty
        title="Skills"
        isSelf={isSelf}
        hasContent={profile.skills.length > 0}
        emptyCta="Add your skills"
      >
        <div className="flex flex-wrap gap-[var(--spacing-8)]">
          {profile.skills.map((skill) => (
            <span
              key={skill.name}
              className="rounded-[var(--radius-tags)] bg-[color:var(--color-mist-gray)] px-3 py-1 text-[length:var(--text-caption)] text-[color:var(--color-ink)]"
            >
              {skill.name}
            </span>
          ))}
        </div>
      </SectionOrEmpty>

      <SectionOrEmpty
        title="Experience"
        isSelf={isSelf}
        hasContent={profile.experience.length > 0}
        emptyCta="Add your experience"
      >
        <ol className="flex flex-col gap-[var(--spacing-16)] border-l border-[color:var(--color-mist-gray)] pl-[var(--spacing-16)]">
          {profile.experience.map((entry) => (
            <li key={entry.id}>
              <p className="text-[length:var(--text-body-sm)] font-medium text-[color:var(--color-ink)]">
                {entry.title}
              </p>
              <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                {entry.company_name} ·{" "}
                {formatDateRange(entry.start_date, entry.end_date, entry.is_current)}
              </p>
              {entry.description && (
                <p className="mt-1 text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
                  {entry.description}
                </p>
              )}
            </li>
          ))}
        </ol>
      </SectionOrEmpty>

      <SectionOrEmpty
        title="Education"
        isSelf={isSelf}
        hasContent={profile.education.length > 0}
        emptyCta="Add your education"
      >
        <ul className="flex flex-col gap-[var(--spacing-8)]">
          {profile.education.map((entry) => (
            <li key={entry.id}>
              <p className="text-[length:var(--text-body-sm)] font-medium text-[color:var(--color-ink)]">
                {entry.school}
              </p>
              <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                {[entry.degree, entry.field_of_study].filter(Boolean).join(", ")}
              </p>
            </li>
          ))}
        </ul>
      </SectionOrEmpty>

      <SectionOrEmpty
        title="Certifications"
        isSelf={isSelf}
        hasContent={profile.certifications.length > 0}
        emptyCta="Add a certification"
      >
        <ul className="flex flex-col gap-[var(--spacing-8)]">
          {profile.certifications.map((entry) => (
            <li
              key={entry.id}
              className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
            >
              {entry.name}{" "}
              <span className="text-[color:var(--color-graphite)]">· {entry.issuer}</span>
            </li>
          ))}
        </ul>
      </SectionOrEmpty>

      <SectionOrEmpty
        title="Portfolio"
        isSelf={isSelf}
        hasContent={profile.portfolio.length > 0}
        emptyCta="Add a portfolio link"
      >
        <ul className="flex flex-col gap-[var(--spacing-8)]">
          {profile.portfolio.map((item) => (
            <li key={item.id}>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)] underline"
              >
                {item.title}
              </a>
            </li>
          ))}
        </ul>
      </SectionOrEmpty>

      <SectionOrEmpty
        title="Languages"
        isSelf={isSelf}
        hasContent={profile.languages.length > 0}
        emptyCta="Add languages you speak"
      >
        <div className="flex flex-wrap gap-[var(--spacing-8)]">
          {profile.languages.map((language) => (
            <span
              key={language.code}
              className="rounded-[var(--radius-tags)] bg-[color:var(--color-mist-gray)] px-3 py-1 text-[length:var(--text-caption)] text-[color:var(--color-ink)]"
            >
              {language.code.toUpperCase()} · {humanize(language.proficiency)}
            </span>
          ))}
        </div>
      </SectionOrEmpty>

      {profile.mutual_connections.count > 0 && (
        <Section
          title={`${profile.mutual_connections.count} mutual connection${profile.mutual_connections.count === 1 ? "" : "s"}`}
        >
          {null}
        </Section>
      )}

      {reportOpen && (
        <ReportModal candidateId={profile.user_id} onClose={() => setReportOpen(false)} />
      )}
    </div>
  );
}

// PRD §13 F11 trigger 4: "who-viewed-me list tapped -> paywall: blurred
// list + count." Free plan gets the real count (never fabricated) with a
// locked full list; Premium gets the real list too.
function WhoViewedMeRow() {
  const [expanded, setExpanded] = useState(false);
  const { data: entitlements } = useQuery({
    queryKey: ["entitlements"],
    queryFn: async () => {
      const response = await fetch("/api/entitlements");
      if (!response.ok) throw new Error("Failed to load entitlements");
      return (await response.json()) as EntitlementsResult;
    },
  });
  const { data: viewers } = useQuery({
    queryKey: ["profile", "viewers"],
    queryFn: async () => {
      const response = await fetch("/api/profile/me/viewers");
      if (!response.ok) throw new Error("Failed to load viewers");
      return (await response.json()) as ProfileViewersResult;
    },
  });

  if (!viewers) return null;
  const isPremium = entitlements?.features.who_viewed_me_full_list ?? false;

  return (
    <Section title="Who viewed me">
      {isPremium ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="min-h-11 content-center text-left text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
        >
          {viewers.count} {viewers.count === 1 ? "person" : "people"} viewed your profile
        </button>
      ) : (
        <Link
          href="/premium?reason=who_viewed_me&return_to=/profile/edit"
          className="flex items-center justify-between rounded-[var(--radius-inputs)] bg-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] no-underline"
        >
          <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
            🔒 {viewers.count} people viewed your profile
          </span>
          <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)]">
            Unlock
          </span>
        </Link>
      )}
      {isPremium && expanded && (
        <ul className="flex flex-col gap-1">
          {viewers.viewers.length === 0 && (
            <li className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
              No views yet.
            </li>
          )}
          {viewers.viewers.map((viewer) => (
            <li
              key={viewer.user_id}
              className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
            >
              {viewer.full_name}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-[var(--spacing-8)] border-t border-[color:var(--color-mist-gray)] pt-[var(--spacing-16)]">
      <h2 className="text-[length:var(--text-caption)] font-medium uppercase tracking-wide text-[color:var(--color-graphite)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

// design.md §14.14's own state row: "Empty (sections) — Own: 'Add your
// experience' inline CTAs. Others: sections omitted entirely, never
// shown as empty." This is that branch, in one place, for every section.
function SectionOrEmpty({
  title,
  isSelf,
  hasContent,
  emptyCta,
  children,
}: {
  title: string;
  isSelf: boolean;
  hasContent: boolean;
  emptyCta: string;
  children: React.ReactNode;
}) {
  if (!hasContent && !isSelf) return null;
  return (
    <Section title={title}>
      {hasContent ? (
        children
      ) : (
        <Link
          href="/profile/edit"
          className="min-h-11 text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)] underline"
        >
          {emptyCta}
        </Link>
      )}
    </Section>
  );
}
