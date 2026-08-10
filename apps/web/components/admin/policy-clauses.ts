// P26.1 assumption, documented per CLAUDE.md's "when blocked" rule: no
// policy-clause taxonomy exists anywhere in the codebase —
// applyModerationActionSchema.policy_clause (packages/validation/src/safety.ts)
// is `z.string().min(1)`, free text, by design (the PRD names "mandatory
// policy-clause selection" in design.md §14.20's mockup — "4.2
// Harassment ▼" — without ever enumerating what the clauses are). This
// is a defensible starting taxonomy loosely numbered after
// REPORT_CATEGORIES so a reviewer can map a report to a clause quickly;
// it is UI-only (a `<select>`'s option list) and never validated
// server-side beyond non-empty, so it can be revised without a
// migration.
export const POLICY_CLAUSES = [
  { value: "1.1", label: "1.1 Child safety" },
  { value: "2.1", label: "2.1 Threats of violence" },
  { value: "2.2", label: "2.2 Credible safety threat" },
  { value: "3.1", label: "3.1 Harassment" },
  { value: "3.2", label: "3.2 Hate speech / discrimination" },
  { value: "4.1", label: "4.1 Scam or fraud" },
  { value: "4.2", label: "4.2 Off-platform payment solicitation" },
  { value: "5.1", label: "5.1 Sexual content" },
  { value: "6.1", label: "6.1 Impersonation / fake profile" },
  { value: "7.1", label: "7.1 Spam" },
  { value: "8.1", label: "8.1 Other conduct violation" },
] as const;
