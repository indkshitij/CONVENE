// PRD §10.2.5 — pure functions for the L0–L4 verification ladder: level
// derivation from achieved signals, and the work-email domain/company
// name comparison. Kept separate from verification-ladder.service.ts (the
// DB-touching half) so both are independently unit-testable.

export interface VerificationSignals {
  emailVerified: boolean;
  phoneVerified: boolean;
  workEmailVerified: boolean;
  governmentIdApproved: boolean;
}

// §10.2.5: level is the *highest* achieved signal, not a count — L3
// doesn't require L2 to have happened first (a user can go straight to a
// work-email verification without ever verifying a phone number).
export function deriveVerificationLevel(signals: VerificationSignals): 0 | 1 | 2 | 3 | 4 {
  if (signals.governmentIdApproved) return 4;
  if (signals.workEmailVerified) return 3;
  if (signals.phoneVerified) return 2;
  if (signals.emailVerified) return 1;
  return 0;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// BR-PROF-12 names a verified-employer *registry* that doesn't exist in
// this codebase (no schema/data for one — flagged in this phase's PR
// description as a scope gap). Absent that registry, "the domain matches
// company_name" is approximated structurally: the email's domain
// (excluding a common public-mail-provider allowlist and the TLD) must
// contain, or be contained by, the normalized company name.
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
]);

export function workEmailDomainMatchesCompany(email: string, companyName: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  if (PUBLIC_EMAIL_DOMAINS.has(domain)) return false;

  const domainRoot = normalize(domain.split(".")[0] ?? "");
  const normalizedCompany = normalize(companyName);
  if (!domainRoot || !normalizedCompany) return false;

  return normalizedCompany.includes(domainRoot) || domainRoot.includes(normalizedCompany);
}
