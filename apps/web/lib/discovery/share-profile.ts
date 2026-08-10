import { pushToast } from "@/stores/ui";

// No backend involved — the "Share" action in a match card's ⋯ menu.
// Native Web Share API where available; clipboard copy as the fallback
// (both are client-only browser APIs, no server round trip).
export async function shareProfile(candidateId: string, fullName: string | null): Promise<void> {
  const url = `${window.location.origin}/profile/${candidateId}`;
  const title = fullName ? `${fullName} on Convene` : "A profile on Convene";

  if (navigator.share) {
    try {
      await navigator.share({ title, url });
    } catch {
      // AbortError from the user dismissing the native share sheet —
      // not a failure worth surfacing.
    }
    return;
  }

  await navigator.clipboard.writeText(url);
  pushToast({ variant: "success", message: "Link copied.", durationMs: 3000 });
}
