import { redirect } from "next/navigation";
import { computeCurrentOnboardingStep } from "@/lib/onboarding/current-step";
import { getSession, type Session } from "./session";

// PRD §18.1: "(app)/layout.tsx guards auth and redirects incomplete
// onboarding to the wizard." Server-only — call from a Server Component
// layout/page, never a Client Component.
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

// UserResponse (apps/api's auth.service.ts) doesn't expose an explicit
// "onboarding complete" boolean, only `onboarding_step` (1-6, the users
// table's own onboarding_step column, which apps/api never actually
// advances past its registration-time default — see
// lib/onboarding/current-step.ts's own comment) and `status` (the
// userStatus enum). No PRD text spells out exactly how a client is meant
// to derive "done" from these two fields — this treats `status ===
// "pending_verification"` as "onboarding still in progress" (every
// other status implies the account cleared onboarding), which is a
// documented assumption, not a transcription.
export function isOnboardingComplete(user: Session["user"]): boolean {
  return user.status !== "pending_verification";
}

// P20.2: redirects to the *real* current step (computed live from
// apps/api's own profile data), not `session.user.onboarding_step` — see
// current-step.ts for why that cookie field can't be trusted. This is
// what makes "wizard state lives on the server, not in the browser"
// true for the auth-guard's own redirect, not just for the wizard pages
// themselves.
export async function requireOnboardingComplete(session: Session): Promise<void> {
  if (!isOnboardingComplete(session.user)) {
    const step = await computeCurrentOnboardingStep(session.accessToken);
    redirect(`/setup/${step}`);
  }
}

// Convenience wrapper for (app)/layout.tsx: auth guard, then onboarding
// guard, in that order (an unauthenticated visitor gets /login before
// ever learning an onboarding-step number).
export async function requireActiveSession(): Promise<Session> {
  const session = await requireSession();
  await requireOnboardingComplete(session);
  return session;
}

// packages/db's userRole enum: ["user", "recruiter", "admin",
// "moderator", "support"]. §17.9's admin endpoints are RBAC-gated
// server-side to admin+moderator (RolesGuard reading AuthContext.role);
// this mirrors that same set here so the (admin) layout doesn't render
// for a signed-in user who'd just get 403s from every real request.
const ADMIN_LAYOUT_ROLES = new Set(["admin", "moderator"]);

// PRD §18.1: "(admin)/admin/… — role-gated at the layout level." Now
// that UserResponse/SessionUser carry `role` (P26.1), this is a real
// gate, not just an authentication check — a non-admin/moderator user is
// redirected to /app rather than seeing an admin shell that would 403 on
// every action.
export async function requireAdminSession(): Promise<Session> {
  const session = await requireSession();
  if (!ADMIN_LAYOUT_ROLES.has(session.user.role)) redirect("/home");
  return session;
}
