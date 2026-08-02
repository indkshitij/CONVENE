import { customType } from "drizzle-orm/pg-core";

// Postgres CITEXT (case-insensitive text) — used for email columns per PRD
// §16.3 so lookups/uniqueness are case-insensitive without app-layer lowering.
export const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

// PostGIS GEOGRAPHY(POINT, 4326) — drizzle-orm's own `geometry()` helper only
// models GEOMETRY, not GEOGRAPHY (PRD §16.3 uses GEOGRAPHY throughout for
// great-circle distance queries). Represented as its WKT string; points are
// written/read via ST_MakePoint(...)::geography raw SQL at the call site.
export const geographyPoint = customType<{ data: string }>({
  dataType() {
    return "geography(point, 4326)";
  },
});

// Postgres TSVECTOR (full-text search) — no drizzle-orm helper exists; the
// column is written to by a trigger/generated expression, never directly.
export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});
