// PRD §17.5/§10.7.5: "exponential backoff 1->2->4->8->16->30s with ±20%
// jitter." Pure/testable — no timers, no WebSocket references — the
// caller (socket.ts) owns actually scheduling the delay.
const BASE_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;
const JITTER_RATIO = 0.2;

export function baseDelayForAttempt(attempt: number): number {
  const index = Math.min(Math.max(attempt, 0), BASE_DELAYS_MS.length - 1);
  return BASE_DELAYS_MS[index]!;
}

// `random` is injectable (defaults to Math.random) purely so tests can
// assert exact boundary values instead of asserting a range.
export function nextBackoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = baseDelayForAttempt(attempt);
  const jitterSpan = base * JITTER_RATIO;
  // Uniform in [base - jitterSpan, base + jitterSpan].
  return base - jitterSpan + random() * jitterSpan * 2;
}
