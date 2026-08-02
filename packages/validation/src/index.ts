export const PACKAGE_NAME = "@convene/validation" as const;

// Namespaced re-exports (not a flat `export *`) — several domains
// deliberately reuse the same common.ts refinement (e.g. both auth.ts and
// availability.ts touch DOB/duration-related names), which would make a
// flat barrel ambiguous. `import { auth, profile } from "@convene/validation"`
// keeps every domain's schemas unambiguous and mirrors "one Zod schema per
// domain object" (P4.1 goal) at the package's public surface too.
export * as common from "./common";
export * as auth from "./auth";
export * as profile from "./profile";
export * as availability from "./availability";
export * as intents from "./intents";
export * as location from "./location";
export * as connections from "./connections";
export * as messaging from "./messaging";
export * as search from "./search";
