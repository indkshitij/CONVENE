import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { deriveVerificationLevel, workEmailDomainMatchesCompany } from "./verification-ladder";

describe("deriveVerificationLevel", () => {
  it("returns 0 when no signal is achieved", () => {
    expect(
      deriveVerificationLevel({
        emailVerified: false,
        phoneVerified: false,
        workEmailVerified: false,
        governmentIdApproved: false,
      }),
    ).toBe(0);
  });

  it("returns the highest achieved level, not a count of achieved signals", () => {
    expect(
      deriveVerificationLevel({
        emailVerified: false,
        phoneVerified: false,
        workEmailVerified: true,
        governmentIdApproved: false,
      }),
    ).toBe(3);
  });

  it("government ID wins even if only email is also verified (levels aren't cumulative gates)", () => {
    expect(
      deriveVerificationLevel({
        emailVerified: true,
        phoneVerified: false,
        workEmailVerified: false,
        governmentIdApproved: true,
      }),
    ).toBe(4);
  });

  it("property: level is always 0-4 and monotonic in the achieved signals", () => {
    fc.assert(
      fc.property(
        fc.record({
          emailVerified: fc.boolean(),
          phoneVerified: fc.boolean(),
          workEmailVerified: fc.boolean(),
          governmentIdApproved: fc.boolean(),
        }),
        (signals) => {
          const level = deriveVerificationLevel(signals);
          expect(level).toBeGreaterThanOrEqual(0);
          expect(level).toBeLessThanOrEqual(4);
          if (signals.governmentIdApproved) expect(level).toBe(4);
          else if (signals.workEmailVerified) expect(level).toBe(3);
          else if (signals.phoneVerified) expect(level).toBe(2);
          else if (signals.emailVerified) expect(level).toBe(1);
          else expect(level).toBe(0);
        },
      ),
    );
  });
});

describe("workEmailDomainMatchesCompany", () => {
  it("matches when the domain root equals the normalized company name", () => {
    expect(workEmailDomainMatchesCompany("alex@xenonlabs.com", "Xenon Labs")).toBe(true);
  });

  it("matches when the domain root is a substring of a longer company name", () => {
    expect(workEmailDomainMatchesCompany("alex@xenon.com", "Xenon Labs Inc.")).toBe(true);
  });

  it("rejects a public email provider even if it happens to share letters with the company name", () => {
    expect(workEmailDomainMatchesCompany("alex@gmail.com", "Gmail Consulting")).toBe(false);
  });

  it("rejects an unrelated domain", () => {
    expect(workEmailDomainMatchesCompany("alex@unrelatedco.com", "Xenon Labs")).toBe(false);
  });

  it("rejects a malformed email with no domain", () => {
    expect(workEmailDomainMatchesCompany("not-an-email", "Xenon Labs")).toBe(false);
  });
});
