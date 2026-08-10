import { apiFetch, type IntentTaxonomyEntry } from "@/lib/api/client";
import { requireSession } from "@/lib/auth/guards";
import { SettingsScreen } from "@/components/settings/settings-screen";

export const metadata = { robots: { index: false, follow: false } };

// design.md §14.18: one continuous scrollable page with nine sections
// (not nine separate routes) — the `[section]` segment (kept for the
// bottom-tab-bar's existing `/settings/account` link) just anchors the
// initial scroll position via SettingsSection's own id, the page itself
// is identical regardless of which section was requested.
export default async function SettingsSectionPage() {
  const session = await requireSession();
  const taxonomy = await apiFetch<IntentTaxonomyEntry[]>("/intents/taxonomy", {
    accessToken: session.accessToken,
  });

  return <SettingsScreen email={session.user.email} taxonomy={taxonomy} />;
}
