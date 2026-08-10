// P21.1 acceptance line: "Server time is authoritative in the UI as well
// as the API." Every function here takes the server's own `expires_at`
// (an absolute ISO timestamp) and derives the remaining time fresh on
// each call — there is no "duration + client-side start time" state
// anywhere for a skewed or manually-adjusted client clock to corrupt.
// The countdown component (availability-card.tsx) calls computeCountdown
// on every tick with a fresh `now()`, never memoizing a target computed
// from the client's own clock at mount time.
const EXPIRING_SOON_THRESHOLD_MS = 5 * 60 * 1000; // design.md §15.7: "turns amber at T-5 min."

export interface CountdownInfo {
  remainingMs: number;
  isExpiringSoon: boolean;
  isExpired: boolean;
}

export function computeCountdown(expiresAt: string, now: () => number = Date.now): CountdownInfo {
  const remainingMs = Math.max(0, new Date(expiresAt).getTime() - now());
  return {
    remainingMs,
    isExpiringSoon: remainingMs > 0 && remainingMs <= EXPIRING_SOON_THRESHOLD_MS,
    isExpired: remainingMs <= 0,
  };
}

// design.md §15.3: "font-variant-numeric: tabular-nums on all countdowns
// ... so digits don't jitter." That's a CSS concern for whatever renders
// this string; the string itself is always zero-padded so the *number of
// characters* is stable regardless (mm:ss, or h:mm:ss once the durations
// permitted by BR-AVAIL-01/BR-AVAIL-05 — up to 240 min — cross an hour).
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
