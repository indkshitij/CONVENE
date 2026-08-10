import { describe, expect, it } from "vitest";
import { deriveGeohashes, encodeGeohash } from "./geohash";

describe("encodeGeohash", () => {
  // The canonical geohash.org / Wikipedia reference vector.
  it("matches the well-known (42.6, -5.6) -> 'ezs42' reference vector", () => {
    expect(encodeGeohash(42.6, -5.6, 5)).toBe("ezs42");
  });

  it("truncating to a shorter precision yields a prefix of the longer encoding", () => {
    const full = encodeGeohash(42.6, -5.6, 9);
    const short = encodeGeohash(42.6, -5.6, 5);
    expect(full.startsWith(short)).toBe(true);
  });

  it("two nearby points share a longer common geohash prefix than two distant points", () => {
    const bengaluru = encodeGeohash(12.9716, 77.5946, 7);
    const bengaluruNearby = encodeGeohash(12.9719, 77.595, 7);
    const mumbai = encodeGeohash(19.076, 72.8777, 7);

    function commonPrefixLength(a: string, b: string): number {
      let i = 0;
      while (i < a.length && a[i] === b[i]) i++;
      return i;
    }

    expect(commonPrefixLength(bengaluru, bengaluruNearby)).toBeGreaterThan(
      commonPrefixLength(bengaluru, mumbai),
    );
  });
});

describe("deriveGeohashes", () => {
  it("geohash3 is exactly the first 3 characters of geohash5", () => {
    const { geohash5, geohash3 } = deriveGeohashes(12.9716, 77.5946);
    expect(geohash5).toHaveLength(5);
    expect(geohash3).toBe(geohash5.slice(0, 3));
  });
});
