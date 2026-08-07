import { createHash } from "node:crypto";

// A zero-dependency, deterministic stand-in for a real semantic embedding
// model — this codebase's default EmbeddingProvider (embedding-provider.ts)
// so nearest-neighbour behaviour is testable and profile refresh works in
// dev/test without a vendor API key, same precedent as
// ConsoleEmailTransport for EMAIL_TRANSPORT. It's a hashing-trick
// bag-of-words vector: each token increments (or decrements, by a
// hash-derived sign) one pseudo-random dimension, then the vector is
// L2-normalized — so texts sharing more tokens land closer together under
// cosine similarity, without any network call. This is NOT a real
// semantic embedding (no synonym/paraphrase awareness) — a real vendor
// model (voyage-3, 1024-d, per PRD) is a separate EmbeddingProvider
// implementation, out of this prompt's scope to build.
export function hashingTrickEmbedding(text: string, dimensions: number): number[] {
  const vector = new Array(dimensions).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const token of tokens) {
    const digest = createHash("sha256").update(token).digest();
    const index = digest.readUInt32BE(0) % dimensions;
    const sign = digest[4]! % 2 === 0 ? 1 : -1;
    vector[index] += sign;
  }
  const norm = Math.sqrt(vector.reduce((sum: number, v: number) => sum + v * v, 0));
  if (norm === 0) return vector;
  return vector.map((v: number) => v / norm);
}

// Both operands are expected to already be unit-length (as
// hashingTrickEmbedding and real embedding vendors both produce), so the
// dot product alone equals cosine similarity — no separate magnitude
// division needed.
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot;
}
