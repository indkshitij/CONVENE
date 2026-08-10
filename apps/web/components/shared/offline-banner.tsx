"use client";

import { useOnlineStatus } from "@/lib/realtime/use-online-status";

// §18.7/§3987: "Offline = persistent banner, cached content readable,
// mutations queued with visible pending state." This is the banner half
// — the "queued-message count in the composer" half belongs to the
// chat composer itself (P23.2, not built yet).
export function OfflineBanner() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-20 bg-[color:var(--color-charcoal)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-center text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)]"
    >
      You&apos;re offline. Changes will sync once you&apos;re back online.
    </div>
  );
}
