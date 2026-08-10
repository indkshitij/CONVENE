import type { safety as safetyValidation } from "@convene/validation";

type ModerationActionType = safetyValidation.ModerationActionType;

// PRD §10.10.2, transcribed verbatim (category, severity, SLA hours, and
// the documented "auto-action pending review"). `autoAction` describes
// what ReportsService.create() does automatically the moment a report of
// that category is filed — see enforcement-ladder.ts for the shared
// duration constants those auto-actions use.
export type AutoActionKind =
  | "immediate_suspension" // child_safety: "Immediate suspension, escalation to legal/authorities per policy." Escalation to legal/authorities is outside this codebase's reach — flagged, not fabricated.
  | "freeze_and_suspension_review" // threats_violence: "Immediate conversation freeze + suspension review." A *review*, not an auto-suspension — a human still decides.
  | "freeze_and_throttle" // harassment_hate, sexual_content: "Conversation freeze; sender throttled" / "Freeze + review."
  | "shadow_limit" // scam_fraud: "Shadow-limit (messages deliverable only to existing connections)."
  | "verification_challenge" // impersonation: "Verification challenge issued." No real verification-flow integration exists to trigger — recorded as a notice for a human/future system to act on.
  | "rate_limit_reduction" // spam: "Rate-limit reduction."
  | "queue_only"; // other: "Queue only."

export interface ReportCatalogueEntry {
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  slaHours: number;
  autoAction: AutoActionKind;
}

// Not typed as `Record<string, ReportCatalogueEntry>` on purpose — an open
// string index defeats `noUncheckedIndexedAccess`'s guarantee that a
// key narrowed by isReportCategory() below is actually present. Letting
// TS infer the exact-key object type instead means
// `REPORT_CATALOGUE[narrowedKey]` never needs an `undefined` check.
export const REPORT_CATALOGUE = {
  child_safety: {
    category: "child_safety",
    severity: "critical",
    slaHours: 1,
    autoAction: "immediate_suspension",
  },
  threats_violence: {
    category: "threats_violence",
    severity: "critical",
    slaHours: 2,
    autoAction: "freeze_and_suspension_review",
  },
  harassment_hate: {
    category: "harassment_hate",
    severity: "high",
    slaHours: 12,
    autoAction: "freeze_and_throttle",
  },
  scam_fraud: {
    category: "scam_fraud",
    severity: "high",
    slaHours: 12,
    autoAction: "shadow_limit",
  },
  sexual_content: {
    category: "sexual_content",
    severity: "high",
    slaHours: 12,
    autoAction: "freeze_and_throttle",
  },
  impersonation: {
    category: "impersonation",
    severity: "medium",
    slaHours: 24,
    autoAction: "verification_challenge",
  },
  spam: { category: "spam", severity: "medium", slaHours: 24, autoAction: "rate_limit_reduction" },
  other: { category: "other", severity: "low", slaHours: 48, autoAction: "queue_only" },
} satisfies Record<string, ReportCatalogueEntry>;

export function isReportCategory(value: string): value is keyof typeof REPORT_CATALOGUE {
  return Object.hasOwn(REPORT_CATALOGUE, value);
}

// §10.10.3's ladder step -> DB action name + duration. `null` duration
// means permanent (only "ban"). "notice"/"warning" carry no duration —
// they're logged, not timed.
export const LADDER_DURATIONS_DAYS: Partial<Record<ModerationActionType, number | null>> = {
  throttle: 7,
  shadow_limit: 14,
  suspend: 30, // §10.10.3: "Suspension, 7-30 days" — 30 is the ceiling; a human admin may pass a shorter expires_at explicitly.
  ban: null,
};

// §10.10.3: "Appeal (all levels) -> SLA 72h."
export const APPEAL_SLA_HOURS = 72;
