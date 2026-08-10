"use client";

import { useState } from "react";

const PROVIDERS = [
  { id: "google", label: "Continue with Google" },
  { id: "linkedin", label: "Continue with LinkedIn" },
] as const;

// design.md §14.3's wireframe shows a 3-button row (Google/Apple/
// LinkedIn) — only google/linkedin have a real backend (see the start
// route's own comment), so only those two render. An Apple button with
// nowhere to POST would be a worse experience than one fewer option.
export function OAuthButtons() {
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);

  async function startOAuth(provider: string) {
    setPendingProvider(provider);
    try {
      const response = await fetch(`/api/auth/oauth/${provider}/start`, { method: "POST" });
      if (!response.ok) throw new Error("oauth start failed");
      const { authorizeUrl } = (await response.json()) as { authorizeUrl: string };
      window.location.assign(authorizeUrl);
    } catch {
      setPendingProvider(null);
    }
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-8)]">
      {PROVIDERS.map((provider) => (
        <button
          key={provider.id}
          type="button"
          disabled={pendingProvider !== null}
          onClick={() => void startOAuth(provider.id)}
          className="min-h-11 w-full rounded-[var(--radius-buttonspill)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body)] text-[color:var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pendingProvider === provider.id ? "Redirecting…" : provider.label}
        </button>
      ))}
    </div>
  );
}
