// design.md §14.6 shared chrome: "progress bar with step count and a
// percentage... persists server-side after every step." `step` is the
// PRD's own 1-6 numbering (step 1 = registration, already complete by
// the time anyone reaches this wizard) so the bar reads as continuous
// with what the user saw during signup, not a wizard-internal renumbering.
const TOTAL_STEPS = 6;

export function WizardProgress({ step }: { step: number }) {
  const percent = Math.round((step / TOTAL_STEPS) * 100);

  return (
    <div className="mb-[var(--spacing-24)]">
      <div className="mb-[var(--spacing-8)] flex items-center justify-between text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
        <span>
          Step {step} of {TOTAL_STEPS}
        </span>
        <span>{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Onboarding progress: step ${step} of ${TOTAL_STEPS}`}
        className="h-1 w-full overflow-hidden rounded-[var(--radius-full-2)] bg-[color:var(--color-mist-gray)]"
      >
        <div
          className="h-full bg-[color:var(--color-iris-blue)]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
