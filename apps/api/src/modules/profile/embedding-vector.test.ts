import { describe, expect, it } from "vitest";
import { cosineSimilarity, hashingTrickEmbedding } from "./embedding-vector";

const DIMENSIONS = 1024;

describe("hashingTrickEmbedding", () => {
  it("is deterministic for identical text", () => {
    const text = "Senior Software Engineer skilled in React and Node.js";
    expect(hashingTrickEmbedding(text, DIMENSIONS)).toEqual(
      hashingTrickEmbedding(text, DIMENSIONS),
    );
  });

  it("produces a unit-length vector for non-empty text", () => {
    const vector = hashingTrickEmbedding(
      "some profile text with several distinct tokens",
      DIMENSIONS,
    );
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("returns an all-zero vector for empty text", () => {
    expect(hashingTrickEmbedding("", DIMENSIONS)).toEqual(new Array(DIMENSIONS).fill(0));
  });
});

describe("cosine query returns the expected nearest neighbour on a fixture set (P7.3 prompt's own testing requirement)", () => {
  const query = hashingTrickEmbedding(
    "Backend engineer working with Node.js and Express APIs",
    DIMENSIONS,
  );

  const candidates = {
    // Shares "engineer", "Node.js" with the query — expected nearest.
    closeMatch: hashingTrickEmbedding(
      "Software engineer building APIs with Node.js and Express",
      DIMENSIONS,
    ),
    // Shares only "engineer" — expected middle.
    distantMatch: hashingTrickEmbedding(
      "Mechanical engineer designing turbine components",
      DIMENSIONS,
    ),
    // Shares nothing — expected farthest.
    unrelated: hashingTrickEmbedding("Pastry chef specializing in French desserts", DIMENSIONS),
  };

  it("ranks the topically closest fixture as the nearest neighbour by cosine similarity", () => {
    const scores = {
      closeMatch: cosineSimilarity(query, candidates.closeMatch),
      distantMatch: cosineSimilarity(query, candidates.distantMatch),
      unrelated: cosineSimilarity(query, candidates.unrelated),
    };

    expect(scores.closeMatch).toBeGreaterThan(scores.distantMatch);
    expect(scores.distantMatch).toBeGreaterThan(scores.unrelated);

    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    expect(ranked[0]?.[0]).toBe("closeMatch");
  });
});
