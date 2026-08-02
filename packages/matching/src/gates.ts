import { type AvailabilityState, type Clock, systemClock } from "./types";

// PRD §11.4 — the hard gates, applied before scoring, in G1..G12 order (the
// PRD doesn't state an explicit evaluation order beyond the numbering
// itself, so this follows the table's own sequence).
export const GATE_IDS = [
  "G1_SELF",
  "G2_BLOCK",
  "G3_SUPPRESSION",
  "G4_RELATIONSHIP",
  "G5_VISIBILITY",
  "G6_STATUS",
  "G7_COMPLETION",
  "G8_INTENT_FLOOR",
  "G9_INBOUND_FILTER",
  "G10_INVISIBLE",
  "G11_COOLDOWN",
  "G12_DORMANT",
] as const;

export type GateId = (typeof GATE_IDS)[number];

export type ProfileVisibility =
  "public" | "authenticated" | "connections_only" | "matches_only" | "private";
export type AccountStatus = "active" | "suspended" | "deleted" | "unverified" | "shadow_limited";

export interface GateContext {
  viewerId: string;
  candidateId: string;
  isBlockedEitherDirection: boolean;
  hasActiveSuppression: boolean;
  isConnectedOrPendingRequest: boolean;
  profileVisibility: ProfileVisibility;
  /** Whether the viewer is a "match" of the candidate — relevant only for matches_only visibility. */
  viewerIsMatch: boolean;
  accountStatus: AccountStatus;
  profileCompletion: number;
  intentScore: number;
  passesInboundFilter: boolean;
  availabilityState: AvailabilityState;
  /** Set when a rejection(<30d)/removal(<7d) cooldown is currently active. */
  cooldownActiveUntil?: Date;
  /** Undefined/never active is treated as dormant (G12). */
  lastSessionAt?: Date;
}

export interface GateResult {
  excluded: boolean;
  gate?: GateId;
}

// PRD §11.4: "G8 is the product's immune system ... re-verified at
// request-send time. No multiplier, plan, or admin flag bypasses it."
// Exported standalone (not just inline inside applyGates) specifically so
// the connections module (§10.6.5's "Intent floor" validation row) can
// re-run this exact check at connection-request send time, per the P4.3
// prompt's explicit instruction.
export const INTENT_FLOOR = 0.2;

export function checkIntentFloor(intentScore: number): boolean {
  return intentScore < INTENT_FLOOR;
}

function gateSelf(ctx: GateContext): boolean {
  return ctx.viewerId === ctx.candidateId;
}

function gateBlock(ctx: GateContext): boolean {
  return ctx.isBlockedEitherDirection;
}

function gateSuppression(ctx: GateContext): boolean {
  return ctx.hasActiveSuppression;
}

function gateRelationship(ctx: GateContext): boolean {
  return ctx.isConnectedOrPendingRequest;
}

function gateVisibility(ctx: GateContext): boolean {
  if (ctx.profileVisibility === "private") return true;
  if (ctx.profileVisibility === "matches_only" && !ctx.viewerIsMatch) return true;
  if (ctx.profileVisibility === "connections_only") return true;
  return false;
}

function gateStatus(ctx: GateContext): boolean {
  return ctx.accountStatus !== "active";
}

function gateCompletion(ctx: GateContext): boolean {
  return ctx.profileCompletion < 40;
}

function gateInboundFilter(ctx: GateContext): boolean {
  return !ctx.passesInboundFilter;
}

function gateInvisible(ctx: GateContext): boolean {
  return ctx.availabilityState === "invisible";
}

function gateCooldown(ctx: GateContext, clock: Clock): boolean {
  if (!ctx.cooldownActiveUntil) return false;
  return clock.now().getTime() < ctx.cooldownActiveUntil.getTime();
}

const DORMANT_DAYS = 90;

function gateDormant(ctx: GateContext, clock: Clock): boolean {
  if (!ctx.lastSessionAt) return true;
  const daysSince = (clock.now().getTime() - ctx.lastSessionAt.getTime()) / 86_400_000;
  return daysSince >= DORMANT_DAYS;
}

export function applyGates(ctx: GateContext, clock: Clock = systemClock): GateResult {
  if (gateSelf(ctx)) return { excluded: true, gate: "G1_SELF" };
  if (gateBlock(ctx)) return { excluded: true, gate: "G2_BLOCK" };
  if (gateSuppression(ctx)) return { excluded: true, gate: "G3_SUPPRESSION" };
  if (gateRelationship(ctx)) return { excluded: true, gate: "G4_RELATIONSHIP" };
  if (gateVisibility(ctx)) return { excluded: true, gate: "G5_VISIBILITY" };
  if (gateStatus(ctx)) return { excluded: true, gate: "G6_STATUS" };
  if (gateCompletion(ctx)) return { excluded: true, gate: "G7_COMPLETION" };
  if (checkIntentFloor(ctx.intentScore)) return { excluded: true, gate: "G8_INTENT_FLOOR" };
  if (gateInboundFilter(ctx)) return { excluded: true, gate: "G9_INBOUND_FILTER" };
  if (gateInvisible(ctx)) return { excluded: true, gate: "G10_INVISIBLE" };
  if (gateCooldown(ctx, clock)) return { excluded: true, gate: "G11_COOLDOWN" };
  if (gateDormant(ctx, clock)) return { excluded: true, gate: "G12_DORMANT" };
  return { excluded: false };
}
