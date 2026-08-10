// Standard geohash encoding (base32, the same scheme geohash.org and every
// major geospatial library uses) — implemented directly rather than adding
// a dependency for ~30 lines of well-defined, easily-tested binary-search
// bit-interleaving. PRD §10.5.2: geohash_5 (~5 km cell, CHAR(5)) and
// geohash_3 (~156 km cell, CHAR(3)) are both truncations of the same full
// encoding, not independently computed.
const BASE32_ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz";

export function encodeGeohash(latitude: number, longitude: number, precision: number): string {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let isEven = true;
  let bit = 0;
  let charIndex = 0;
  let geohash = "";

  while (geohash.length < precision) {
    if (isEven) {
      const mid = (lngMin + lngMax) / 2;
      if (longitude >= mid) {
        charIndex = (charIndex << 1) | 1;
        lngMin = mid;
      } else {
        charIndex = charIndex << 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (latitude >= mid) {
        charIndex = (charIndex << 1) | 1;
        latMin = mid;
      } else {
        charIndex = charIndex << 1;
        latMax = mid;
      }
    }
    isEven = !isEven;

    bit += 1;
    if (bit === 5) {
      geohash += BASE32_ALPHABET[charIndex];
      bit = 0;
      charIndex = 0;
    }
  }

  return geohash;
}

export interface GeohashPair {
  geohash5: string;
  geohash3: string;
}

export function deriveGeohashes(latitude: number, longitude: number): GeohashPair {
  const geohash5 = encodeGeohash(latitude, longitude, 5);
  return { geohash5, geohash3: geohash5.slice(0, 3) };
}
