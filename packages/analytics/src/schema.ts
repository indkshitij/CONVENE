// PRD §21.2: "Every event carries a common envelope: user_id
// (pseudonymous), session_id, device_id, platform, app_version,
// timestamp, request_id, plus plan, city_id, tenure_days, and an
// experiment-assignment map." track() (track.ts) attaches this
// automatically — callers never type these fields themselves, which is
// what keeps every event carrying the full envelope rather than an
// ad-hoc subset a caller forgot a field on.
export type Platform = "web" | "ios" | "android";

export interface AnalyticsEnvelope {
  user_id: string;
  session_id: string;
  device_id: string;
  platform: Platform;
  app_version: string;
  timestamp: string;
  request_id: string | null;
  plan: "free" | "premium";
  city_id: number | null;
  tenure_days: number;
  experiments: Record<string, string>;
}

// §21.2: "No message content, no coordinates, and no profile free-text
// ever enter analytics." This is the literal field-name deny-list that
// backs the type-level tripwire in events.ts — every payload shape in
// EventRegistry is checked against this list, and the registry itself
// fails to compile if any payload uses one of these keys. Kept broad
// (covers every free-text/coordinate field name actually used anywhere
// else in this codebase — profile.about/bio/headline, availability's
// note, messages' body, location's latitude/longitude/geohash) rather
// than narrow, since the cost of a false-positive rejection (rename the
// field, or bucket the value instead) is far lower than a real leak.
export type DeniedAnalyticsPayloadKeys =
  | "body"
  | "message_body"
  | "text"
  | "content"
  | "free_text"
  | "note"
  | "about"
  | "bio"
  | "headline"
  | "detail"
  | "description"
  | "reason_text"
  | "search_query"
  | "query"
  | "coordinates"
  | "latitude"
  | "longitude"
  | "lat"
  | "lng"
  | "geohash"
  | "address"
  | "location"
  | "full_name"
  | "email"
  | "phone";

// Structural check used by events.ts: `never` iff `T`'s keys don't
// overlap the deny-list at all.
export type DeniedKeysOf<T> = Extract<keyof T, DeniedAnalyticsPayloadKeys>;
