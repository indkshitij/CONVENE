// PRD §11.8: "Pagination: opaque cursor encoding {score, id,
// expansion_stage, filter_hash, generated_at}. If the underlying set
// changes mid-pagination (availability churn), the cursor still yields a
// consistent, non-duplicating sequence because it seeks on (score, id).
// Cursors expire after 10 min."
export interface FeedCursor {
  score: number;
  id: string;
  expansionStage: number;
  filterHash: string;
  generatedAt: string; // ISO 8601 — plain JSON can't carry a Date.
}

export const CURSOR_TTL_MS = 10 * 60_000;

// Base64url of a compact JSON object — "opaque" to the client, not
// encrypted (nothing in it is sensitive: a score, a user id already
// visible in the page it came from, an expansion stage, and a hash of
// public filter params). Encoding, not encryption, is the PRD's own
// stated bar ("opaque cursor encoding ..."), same as most cursor-
// pagination APIs.
export function encodeCursor(cursor: FeedCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

// Returns null for anything that doesn't decode to a well-formed cursor
// (tampered, truncated, or simply garbage input) rather than throwing —
// callers treat an invalid cursor as "start from the beginning," not as
// a hard error, since a client replaying a stale/corrupted cursor should
// degrade gracefully.
export function decodeCursor(token: string): FeedCursor | null {
  try {
    const json = Buffer.from(token, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (!isFeedCursor(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isFeedCursor(value: unknown): value is FeedCursor {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.score === "number" &&
    typeof candidate.id === "string" &&
    typeof candidate.expansionStage === "number" &&
    typeof candidate.filterHash === "string" &&
    typeof candidate.generatedAt === "string"
  );
}

export function isCursorExpired(cursor: FeedCursor, now: Date): boolean {
  const generatedAtMs = new Date(cursor.generatedAt).getTime();
  if (Number.isNaN(generatedAtMs)) return true;
  return now.getTime() - generatedAtMs > CURSOR_TTL_MS;
}

// PRD §11.8: "the cursor still yields a consistent, non-duplicating
// sequence because it seeks on (score, id)." Sort order is score DESC
// then id ASC (§11.8's own rank() tie-break) — seeking past a boundary
// means: strictly lower score, OR equal score with a strictly greater id.
export function isPastCursorBoundary(
  candidateScore: number,
  candidateId: string,
  cursor: FeedCursor,
): boolean {
  if (candidateScore !== cursor.score) return candidateScore < cursor.score;
  return candidateId > cursor.id;
}
