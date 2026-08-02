import { SetMetadata } from "@nestjs/common";
import type { RateLimitScope } from "./policies";

export const RATE_LIMIT_METADATA_KEY = "convene:rate-limit";

export interface RateLimitDecoratorOptions {
  scope: RateLimitScope;
}

// PRD P3.4: "every policy from the §17.6 table lives in policies.ts as
// data, not scattered across controllers." Deliberately narrowed to
// { scope } only — a controller names a policy, it never hand-types a
// limit or window at the call site.
export function RateLimit(options: RateLimitDecoratorOptions): MethodDecorator {
  return SetMetadata(RATE_LIMIT_METADATA_KEY, options);
}
