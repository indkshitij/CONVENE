"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import type {
  BlockedUser,
  EntitlementsResult,
  InboundFiltersResponse,
  IntentTaxonomyEntry,
  NotificationPreferencesResponse,
  SessionSummary,
} from "@/lib/api/client";
import { pushToast } from "@/stores/ui";

// notification-catalogue.ts's own `forcedOn` set (moderation_action,
// security_alert, plan_billing) — GET /notifications/preferences doesn't
// echo that metadata back, so this mirrors the real server-side constant
// rather than guessing which categories are forced.
const FORCED_ON_CATEGORIES = new Set(["moderation_action", "security_alert", "plan_billing"]);
const NOTIFICATION_CATEGORIES = [
  "new_match_high",
  "connection_request",
  "request_accepted",
  "new_message",
  "availability_expiring",
  "availability_window_starting",
  "convene_hours_starting",
  "intent_expiring",
  "saved_search_alert",
  "profile_view",
  "weekly_digest",
  "reputation_change",
  "moderation_action",
  "security_alert",
  "plan_billing",
];

function humanize(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function ComingSoon({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between py-[var(--spacing-8)]">
      <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
        {label}
      </span>
      <span className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
        Coming soon
      </span>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      id={title.toLowerCase().replace(/\s+/g, "-")}
      className="flex flex-col gap-[var(--spacing-8)] border-t border-[color:var(--color-mist-gray)] pt-[var(--spacing-16)]"
    >
      <h2 className="text-[length:var(--text-caption)] font-medium uppercase tracking-wide text-[color:var(--color-graphite)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function SettingsScreen({
  email,
  taxonomy,
}: {
  email: string | null;
  taxonomy: IntentTaxonomyEntry[];
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-[var(--spacing-16)] px-[var(--spacing-24)] py-[var(--spacing-24)]">
      <div className="flex items-center gap-[var(--spacing-8)]">
        <Link
          href="/home"
          aria-label="Back"
          className="min-h-11 min-w-11 content-center text-[length:var(--text-body)] text-[color:var(--color-ink)]"
        >
          ←
        </Link>
        <h1 className="text-[length:var(--text-heading-sm)] font-[family-name:var(--font-aeonik)] text-[color:var(--color-ink)]">
          Settings
        </h1>
      </div>

      <AccountSection email={email} />
      <PrivacySection />
      <AvailabilitySection />
      <IntentsFiltersSection taxonomy={taxonomy} />
      <NotificationsSection />
      <DiscoverySection />
      <SubscriptionSection />
      <DataPrivacySection />
      <SafetySection />
    </div>
  );
}

function AccountSection({ email }: { email: string | null }) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  async function loadSessions() {
    const response = await fetch("/api/auth/sessions");
    if (response.ok)
      setSessions(((await response.json()) as { sessions: SessionSummary[] }).sessions);
  }

  async function revoke(id: string) {
    await fetch(`/api/auth/sessions/${id}`, { method: "DELETE" });
    setSessions((current) => current?.filter((session) => session.id !== id) ?? null);
  }

  async function changePassword() {
    setPasswordError(null);
    const response = await fetch("/api/auth/password/change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setPasswordError(body?.error?.message ?? "Couldn't change your password.");
      return;
    }
    pushToast({ variant: "success", message: "Password changed.", durationMs: 3000 });
    setShowPasswordForm(false);
    setCurrentPassword("");
    setNewPassword("");
  }

  return (
    <SettingsSection title="Account">
      <div className="flex items-center justify-between py-[var(--spacing-8)]">
        <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
          Email
        </span>
        <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
          {email ?? "—"}
        </span>
      </div>
      <ComingSoon label="Two-factor authentication" />
      <ComingSoon label="Linked accounts" />

      <div className="py-[var(--spacing-8)]">
        <button
          type="button"
          onClick={() => setShowPasswordForm((open) => !open)}
          className="min-h-11 text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)]"
        >
          Password &amp; security
        </button>
        {showPasswordForm && (
          <div className="mt-[var(--spacing-8)] flex flex-col gap-[var(--spacing-8)]">
            {passwordError && (
              <p
                role="alert"
                className="text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]"
              >
                {passwordError}
              </p>
            )}
            <input
              type="password"
              aria-label="Current password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)]"
            />
            <input
              type="password"
              aria-label="New password"
              placeholder="New password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)]"
            />
            <button
              type="button"
              onClick={() => void changePassword()}
              className="min-h-11 self-start rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)]"
            >
              Update password
            </button>
          </div>
        )}
      </div>

      <div className="py-[var(--spacing-8)]">
        <button
          type="button"
          onClick={() => void loadSessions()}
          className="min-h-11 text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)]"
        >
          Active sessions{sessions ? ` (${sessions.length})` : ""}
        </button>
        {sessions && (
          <ul className="mt-[var(--spacing-8)] flex flex-col gap-[var(--spacing-8)]">
            {sessions.map((session) => (
              <li
                key={session.id}
                className="flex items-center justify-between text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
              >
                <span>
                  {session.device ?? "Unknown device"} {session.current && "(this device)"}
                </span>
                {!session.current && (
                  <button
                    type="button"
                    onClick={() => void revoke(session.id)}
                    className="min-h-11 text-[length:var(--text-caption)] text-[color:var(--color-danger-text)]"
                  >
                    Sign out
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingsSection>
  );
}

function PrivacySection() {
  const [locationPrivacy, setLocationPrivacy] = useState("city_only");
  const [saved, setSaved] = useState(false);

  async function save(value: string) {
    setLocationPrivacy(value);
    const response = await fetch("/api/location/privacy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location_privacy: value }),
    });
    if (response.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  return (
    <SettingsSection title="Privacy">
      <div className="flex items-center justify-between py-[var(--spacing-8)]">
        <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
          Profile visibility
        </span>
        <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
          Public
        </span>
      </div>
      <label className="flex items-center justify-between py-[var(--spacing-8)]">
        <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
          Location precision
        </span>
        <select
          value={locationPrivacy}
          onChange={(event) => void save(event.target.value)}
          className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-8)] text-[length:var(--text-body-sm)]"
        >
          <option value="exact">Exact</option>
          <option value="city_only">City only</option>
          <option value="hidden">Hidden</option>
        </select>
      </label>
      {saved && (
        <span className="self-end text-[length:var(--text-caption)] text-[color:var(--color-iris-blue)]">
          Saved ✓
        </span>
      )}
      <ComingSoon label="Show last seen" />
      <ComingSoon label="Read receipts" />
      <a
        href="#intents-&-inbound-filters"
        className="min-h-11 content-center text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)]"
      >
        Who can send requests ›
      </a>
    </SettingsSection>
  );
}

function AvailabilitySection() {
  return (
    <SettingsSection title="Availability">
      <div className="flex items-center justify-between py-[var(--spacing-8)]">
        <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
          Default duration
        </span>
        <Link
          href="/home"
          className="text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)] underline"
        >
          Set when going available
        </Link>
      </div>
      <ComingSoon label="Quiet hours" />
      <ComingSoon label="Join Convene Hours" />
      <ComingSoon label="Auto-away" />
      <ComingSoon label="Recurring windows" />
    </SettingsSection>
  );
}

function IntentsFiltersSection({ taxonomy }: { taxonomy: IntentTaxonomyEntry[] }) {
  const [filters, setFilters] = useState<InboundFiltersResponse | null>(null);
  const [saved, setSaved] = useState(false);

  const { data } = useQuery({
    queryKey: ["settings", "inbound-filters"],
    queryFn: async () => {
      const response = await fetch("/api/settings/inbound-intent-filters");
      if (!response.ok) throw new Error("Failed to load");
      return (await response.json()) as InboundFiltersResponse;
    },
  });
  const current = filters ?? data ?? null;

  async function save(next: InboundFiltersResponse) {
    setFilters(next);
    const response = await fetch("/api/settings/inbound-intent-filters", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (response.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  if (!current) return <SettingsSection title="Intents & inbound filters">{null}</SettingsSection>;

  const accepted = current.accepted_intents ?? [];

  return (
    <SettingsSection title="Intents & inbound filters">
      <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
        Who can send you connection requests.
      </p>
      <fieldset>
        <legend className="mb-[var(--spacing-8)] text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
          Accepted intents (all, if none selected)
        </legend>
        <div className="flex flex-wrap gap-[var(--spacing-8)]">
          {taxonomy.map((entry) => {
            const checked = accepted.includes(entry.type);
            return (
              <button
                key={entry.type}
                type="button"
                onClick={() =>
                  void save({
                    ...current,
                    accepted_intents: checked
                      ? accepted.filter((type) => type !== entry.type)
                      : [...accepted, entry.type],
                  })
                }
                aria-pressed={checked}
                className={`min-h-11 rounded-[var(--radius-tags)] border px-3 py-1 text-[length:var(--text-caption)] ${checked ? "border-[color:var(--color-iris-blue)] bg-[color:var(--color-lavender-wash)]" : "border-[color:var(--color-mist-gray)]"}`}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <label className="flex items-center gap-[var(--spacing-8)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
        <input
          type="checkbox"
          checked={current.verified_only}
          onChange={(event) => void save({ ...current, verified_only: event.target.checked })}
        />
        Only accept requests from verified members
      </label>
      <label className="flex items-center justify-between py-[var(--spacing-8)]">
        <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
          Max requests per day
        </span>
        <input
          type="number"
          min={1}
          max={200}
          value={current.max_inbound_per_day ?? ""}
          onChange={(event) =>
            void save({
              ...current,
              max_inbound_per_day: event.target.value ? Number(event.target.value) : null,
            })
          }
          className="min-h-11 w-24 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-8)] text-[length:var(--text-body-sm)]"
        />
      </label>
      {saved && (
        <span className="self-end text-[length:var(--text-caption)] text-[color:var(--color-iris-blue)]">
          Saved ✓
        </span>
      )}
    </SettingsSection>
  );
}

function NotificationsSection() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["settings", "notification-preferences"],
    queryFn: async () => {
      const response = await fetch("/api/notifications/preferences");
      if (!response.ok) throw new Error("Failed to load");
      return (await response.json()) as NotificationPreferencesResponse;
    },
  });

  async function toggle(category: string, channel: "push" | "in_app" | "email", value: boolean) {
    const nextCategories = {
      ...(data?.categories ?? {}),
      [category]: { ...(data?.categories?.[category] ?? {}), [channel]: value },
    };
    await fetch("/api/notifications/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categories: nextCategories }),
    });
    void queryClient.invalidateQueries({ queryKey: ["settings", "notification-preferences"] });
  }

  return (
    <SettingsSection title="Notifications">
      <div className="overflow-x-auto">
        <table className="w-full text-[length:var(--text-caption)]">
          <thead>
            <tr className="text-left text-[color:var(--color-graphite)]">
              <th className="py-1 pr-2">Category</th>
              <th className="px-2">Push</th>
              <th className="px-2">In-app</th>
              <th className="px-2">Email</th>
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_CATEGORIES.map((category) => {
              const forced = FORCED_ON_CATEGORIES.has(category);
              const prefs = data?.categories?.[category];
              return (
                <tr key={category} className="border-t border-[color:var(--color-mist-gray)]">
                  <td className="py-2 pr-2 text-[color:var(--color-ink)]">{humanize(category)}</td>
                  {(["push", "in_app", "email"] as const).map((channel) => (
                    <td key={channel} className="px-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${humanize(category)} ${channel}`}
                        checked={forced ? true : (prefs?.[channel] ?? true)}
                        disabled={forced}
                        onChange={(event) => void toggle(category, channel, event.target.checked)}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SettingsSection>
  );
}

function DiscoverySection() {
  const [radius, setRadius] = useState(25);
  const [remotePreference, setRemotePreference] = useState("any");
  const [openToRelocate, setOpenToRelocate] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    const response = await fetch("/api/preferences/location", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        search_radius_km: radius,
        remote_preference: remotePreference,
        open_to_relocate: openToRelocate,
      }),
    });
    if (response.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  return (
    <SettingsSection title="Discovery preferences">
      <label className="flex items-center justify-between py-[var(--spacing-8)]">
        <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
          Search radius
        </span>
        <select
          value={radius}
          onChange={(event) => setRadius(Number(event.target.value))}
          className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-8)] text-[length:var(--text-body-sm)]"
        >
          {[5, 10, 25, 50, 100].map((preset) => (
            <option key={preset} value={preset}>
              {preset} km
            </option>
          ))}
        </select>
      </label>
      <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
        Custom radius up to 500 km is a Premium feature.
      </p>
      <label className="flex items-center justify-between py-[var(--spacing-8)]">
        <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
          Remote preference
        </span>
        <select
          value={remotePreference}
          onChange={(event) => setRemotePreference(event.target.value)}
          className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-8)] text-[length:var(--text-body-sm)]"
        >
          <option value="onsite">Onsite</option>
          <option value="hybrid">Hybrid</option>
          <option value="remote">Remote</option>
          <option value="any">Any</option>
        </select>
      </label>
      <label className="flex items-center gap-[var(--spacing-8)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
        <input
          type="checkbox"
          checked={openToRelocate}
          onChange={(event) => setOpenToRelocate(event.target.checked)}
        />
        Open to relocating
      </label>
      <div className="flex items-center gap-[var(--spacing-8)]">
        <button
          type="button"
          onClick={() => void save()}
          className="min-h-11 rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)]"
        >
          Save
        </button>
        {saved && (
          <span className="text-[length:var(--text-caption)] text-[color:var(--color-iris-blue)]">
            Saved ✓
          </span>
        )}
      </div>
    </SettingsSection>
  );
}

function SubscriptionSection() {
  const { data } = useQuery({
    queryKey: ["entitlements"],
    queryFn: async () => {
      const response = await fetch("/api/entitlements");
      if (!response.ok) throw new Error("Failed to load");
      return (await response.json()) as EntitlementsResult;
    },
  });

  return (
    <SettingsSection title="Subscription & billing">
      <div className="flex items-center justify-between py-[var(--spacing-8)]">
        <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
          Current plan
        </span>
        <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
          {data ? humanize(data.plan) : "—"}
        </span>
      </div>
      <Link
        href="/premium"
        className="min-h-11 content-center text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)]"
      >
        See Premium plans ›
      </Link>
    </SettingsSection>
  );
}

function DataPrivacySection() {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [purgeAt, setPurgeAt] = useState<string | null>(null);

  async function requestDeletion() {
    const response = await fetch("/api/auth/account/delete", { method: "POST" });
    if (response.ok) {
      const body = (await response.json()) as { purge_scheduled_at: string };
      setPurgeAt(body.purge_scheduled_at);
    }
    setConfirmDelete(false);
  }

  async function cancelDeletion() {
    const response = await fetch("/api/auth/account/cancel-delete", { method: "POST" });
    if (response.ok) setPurgeAt(null);
  }

  return (
    <SettingsSection title="Data & privacy">
      <ComingSoon label="Download my data" />
      {purgeAt ? (
        <div className="flex items-center justify-between py-[var(--spacing-8)]">
          <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]">
            Account scheduled for deletion on {new Date(purgeAt).toLocaleDateString()}
          </span>
          <button
            type="button"
            onClick={() => void cancelDeletion()}
            className="min-h-11 text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)] underline"
          >
            Cancel
          </button>
        </div>
      ) : confirmDelete ? (
        <div className="flex items-center gap-[var(--spacing-8)] py-[var(--spacing-8)]">
          <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
            Delete your account? This starts a 30-day grace period.
          </span>
          <button
            type="button"
            onClick={() => void requestDeletion()}
            className="min-h-11 text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            className="min-h-11 text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="min-h-11 content-center text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]"
        >
          Delete account ›
        </button>
      )}
    </SettingsSection>
  );
}

function SafetySection() {
  const [blocked, setBlocked] = useState<BlockedUser[] | null>(null);

  async function load() {
    const response = await fetch("/api/blocks");
    if (response.ok) setBlocked(((await response.json()) as { blocks: BlockedUser[] }).blocks);
  }

  async function unblock(id: string) {
    await fetch(`/api/blocks/${id}`, { method: "DELETE" });
    setBlocked((current) => current?.filter((entry) => entry.blocked_id !== id) ?? null);
  }

  return (
    <SettingsSection title="Safety">
      <button
        type="button"
        onClick={() => void load()}
        className="min-h-11 content-center text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)]"
      >
        Blocked users{blocked ? ` (${blocked.length})` : ""}
      </button>
      {blocked && (
        <ul className="mt-[var(--spacing-8)] flex flex-col gap-[var(--spacing-8)]">
          {blocked.length === 0 && (
            <li className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
              No blocked users.
            </li>
          )}
          {blocked.map((entry) => (
            <li
              key={entry.blocked_id}
              className="flex items-center justify-between text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
            >
              <span>{entry.blocked_id}</span>
              <button
                type="button"
                onClick={() => void unblock(entry.blocked_id)}
                className="min-h-11 text-[length:var(--text-caption)] text-[color:var(--color-iris-blue)] underline"
              >
                Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
      <ComingSoon label="Report history" />
    </SettingsSection>
  );
}
