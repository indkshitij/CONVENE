import { redirect } from "next/navigation";
import {
  apiFetch,
  apiFetchWithHeaders,
  type Industry,
  type IntentResponse,
  type IntentTaxonomyEntry,
  type ProfileResponse,
} from "@/lib/api/client";
import { isOnboardingComplete, requireSession } from "@/lib/auth/guards";
import {
  computeCurrentOnboardingStep,
  FIRST_WIZARD_STEP,
  TOTAL_WIZARD_STEPS,
} from "@/lib/onboarding/current-step";
import { WizardProgress } from "@/components/onboarding/wizard-progress";
import { IdentityBasicsForm } from "./identity-basics-form";
import { ProfessionalDepthForm } from "./professional-depth-form";
import { IntentsForm } from "./intents-form";
import { LocationForm } from "./location-form";
import { GoAvailableForm } from "./go-available-form";

export const metadata = {
  robots: { index: false, follow: false },
};

const STEP_TITLES: Record<number, { title: string; subtitle: string }> = {
  2: { title: "Tell us about you", subtitle: "This is what other members see first." },
  3: {
    title: "Your professional background",
    subtitle: "Helps us match you with the right people.",
  },
  4: { title: "What are you here for?", subtitle: "Pick at least one intent to get started." },
  5: { title: "Where are you based?", subtitle: "We use this to find nearby matches." },
  6: { title: "Go available", subtitle: "Signal you're ready to connect right now." },
};

// PRD §18.1: "(onboarding)/setup/[step]/page.tsx — 6-step wizard,
// server-resumed." §18.2: "Server Component reads the current step from
// the session, Client Components per form." This Server Component is
// also the auth guard for the whole wizard (P19.1's (app)/layout.tsx
// guard doesn't cover the (onboarding) group at all) and the
// can't-skip-ahead gate — see lib/onboarding/current-step.ts for why the
// "current step" it checks against is computed live from apps/api,
// never trusted from the session cookie.
export default async function OnboardingStepPage({
  params,
}: {
  params: Promise<{ step: string }>;
}) {
  const session = await requireSession();
  const { step: stepParam } = await params;
  const requestedStep = Number(stepParam);

  if (isOnboardingComplete(session.user)) redirect("/home");
  if (!Number.isInteger(requestedStep) || requestedStep < FIRST_WIZARD_STEP)
    redirect(`/setup/${FIRST_WIZARD_STEP}`);

  const realStep = await computeCurrentOnboardingStep(session.accessToken);
  // A user may go *back* to review/edit an already-completed step
  // (design.md §14.6: "back navigation without data loss") but can't
  // jump *ahead* of where the server says they actually are.
  if (requestedStep > realStep) redirect(`/setup/${realStep}`);

  const copy =
    STEP_TITLES[Math.min(requestedStep, TOTAL_WIZARD_STEPS)] ?? STEP_TITLES[TOTAL_WIZARD_STEPS]!;

  let profile: ProfileResponse | null = null;
  let etag: string | null = null;
  let industries: Industry[] = [];
  let taxonomy: IntentTaxonomyEntry[] = [];
  let intents: IntentResponse[] = [];

  // Steps 2-5 all need the current profile: 2/3 to prefill their own
  // fields, 4 to evaluate intent prerequisites (company/years-experience/
  // verification-level), 5 to show an already-set city on review.
  if (requestedStep >= 2 && requestedStep <= 5) {
    const result = await apiFetchWithHeaders<ProfileResponse>("/profiles/me", {
      accessToken: session.accessToken,
    });
    profile = result.data;
    etag = result.headers.get("etag");
  }
  if (requestedStep === 3) {
    const result = await apiFetch<{ industries: Industry[] }>("/taxonomies/industries");
    industries = result.industries;
  }
  // Step 4 needs both to render the picker; step 6 needs the intents list
  // (for the session-intent selector) and the taxonomy (for their labels).
  if (requestedStep === 4 || requestedStep === 6) {
    taxonomy = await apiFetch<IntentTaxonomyEntry[]>("/intents/taxonomy", {
      accessToken: session.accessToken,
    });
    intents = await apiFetch<IntentResponse[]>("/intents", { accessToken: session.accessToken });
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-[var(--spacing-24)] py-[var(--spacing-40)]">
      <div className="w-full max-w-lg">
        <WizardProgress step={requestedStep} />
        <h1 className="text-[length:var(--text-heading-sm)] font-[family-name:var(--font-aeonik)] text-[color:var(--color-ink)]">
          {copy.title}
        </h1>
        <p className="mt-[var(--spacing-8)] text-[length:var(--text-body)] text-[color:var(--color-graphite)]">
          {copy.subtitle}
        </p>

        <div className="mt-[var(--spacing-24)]">
          {requestedStep === 2 && (
            <IdentityBasicsForm profile={profile!} etag={etag} fullName={session.user.full_name} />
          )}
          {requestedStep === 3 && (
            <ProfessionalDepthForm profile={profile!} etag={etag} industries={industries} />
          )}
          {requestedStep === 4 && (
            <IntentsForm profile={profile!} initialIntents={intents} taxonomy={taxonomy} />
          )}
          {requestedStep === 5 && <LocationForm profile={profile!} />}
          {requestedStep === 6 && <GoAvailableForm activeIntents={intents} taxonomy={taxonomy} />}
        </div>
      </div>
    </main>
  );
}
