import { apiFetch, type ProfileResponse } from "@/lib/api/client";

// PRD §10.1.3's own step numbers (step 1 = registration, which happens
// entirely outside this wizard at /signup+/verify — the wizard itself is
// design.md §14.6's "Steps 2-6"). All six wizard steps are now built
// (P20.2: 2-3, P20.3: 4-6) — TOTAL_WIZARD_STEPS replaces the old
// LAST_BUILT_STEP cap that existed only while steps 4-6 were unbuilt.
export const FIRST_WIZARD_STEP = 2;
export const TOTAL_WIZARD_STEPS = 6;

// §10.1's step 2 requirement: "name, photo, headline, current role/
// company" with only the photo optional — headline and job_title are
// the two required fields this function can actually check (full_name
// already exists from registration).
function isIdentityBasicsComplete(profile: ProfileResponse): boolean {
  return Boolean(profile.headline && profile.job_title);
}

// §10.1's step 3: "industry, years of experience, top 5 skills,
// education (or LinkedIn import)... skills/education skippable." Only
// `industry` is checked — `years_experience` defaults to "0" in the
// database (packages/db/src/schema/profiles.ts), which is
// indistinguishable from "a genuine zero-experience answer" vs "never
// answered," so it can't reliably signal completion on its own. Skills
// and education are explicitly skippable per the PRD table, so their
// absence doesn't block step-3 completion either.
function isProfessionalDepthComplete(profile: ProfileResponse): boolean {
  return profile.industry !== null;
}

// §10.1.3 step 4: "min 1" required, not skippable — BR-AUTH-09: "Users
// cannot access discovery until Step 4 (intent selection) is complete."
// ProfileResponse.intents is the lightweight summary GET /profiles/me
// already returns; its length is sufficient to gate this without a
// separate GET /intents round trip.
function isIntentsComplete(profile: ProfileResponse): boolean {
  return profile.intents.length > 0;
}

// §10.1.3 step 5: "Required: ✓ (city minimum)... Precise location
// skippable." A city is set whether the user granted GPS or fell back to
// manual selection — either path populates profile.location.city.
function isLocationComplete(profile: ProfileResponse): boolean {
  return profile.location.city !== null;
}

// PRD's own acceptance line for this phase: "Wizard state lives on the
// server, not in the browser." apps/api never writes `users.onboarding_
// step` past its registration-time default of 1 (grepped the whole
// service layer — confirmed dead going forward), so the session
// cookie's own `onboarding_step` can't be trusted as "current step."
// This derives the real current step from a live GET /profiles/me on
// every call instead — the server (apps/api's own data), not a stale
// client-held number, decides where the wizard resumes.
//
// Step 6 (Go available) is "Required: Encouraged, Skippable: ✓" per
// §10.1.3 — there's no server-observable "step 6 complete" signal to
// check (unlike steps 2-5, nothing about it is required), so once step 5
// is satisfied the wizard's resting position is simply 6; step 6's own
// three terminal actions (go available / schedule / not now) navigate to
// /home directly rather than advancing to a nonexistent step 7.
export async function computeCurrentOnboardingStep(accessToken: string): Promise<number> {
  const profile = await apiFetch<ProfileResponse>("/profiles/me", { accessToken });
  if (!isIdentityBasicsComplete(profile)) return 2;
  if (!isProfessionalDepthComplete(profile)) return 3;
  if (!isIntentsComplete(profile)) return 4;
  if (!isLocationComplete(profile)) return 5;
  return TOTAL_WIZARD_STEPS;
}
