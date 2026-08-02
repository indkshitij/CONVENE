import { randomBytes } from "node:crypto";

// RFC 9562 UUIDv7 — 48-bit ms timestamp + random bits, version/variant set.
// Mirrors packages/db/migrations' public.uuidv7() SQL function so ids
// generated in the API (e.g. X-Request-Id) follow the same convention PRD
// §17.9 states for every id ("all ids UUIDv7").
export function uuidv7(): string {
  const bytes = randomBytes(16);
  const ts = BigInt(Date.now());

  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // version 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
