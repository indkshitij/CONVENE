// PRD §11.5.4: "s_mutual(v, c): m = mutualConnectionCount(v, c); return
// min(1.0, log1p(m) / log1p(8))." mutualConnectionCount is a connection-
// graph query (this package has no I/O) — injected by the caller.
export function mutualScore(mutualConnectionCount: number): number {
  return Math.min(1.0, Math.log1p(mutualConnectionCount) / Math.log1p(8));
}
