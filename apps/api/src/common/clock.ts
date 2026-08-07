// Generic time injection so services can be tested without real delays —
// the same pattern packages/matching uses (P4.2's "inject a clock"), kept
// as its own small utility here rather than reaching into a domain
// package (packages/matching) for something this generic.
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
