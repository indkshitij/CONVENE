// §13.2: "Age < 18 -> Terminal: age-restricted, no account created."
// A dedicated terminal state, not an inline field error — there's
// nothing left to correct or retry.
export function AgeGateScreen() {
  return (
    <div className="flex flex-col gap-[var(--spacing-16)] text-center">
      <h1 className="text-[length:var(--text-heading-sm)] font-[family-name:var(--font-aeonik)] text-[color:var(--color-ink)]">
        Convene is for adults
      </h1>
      <p className="text-[length:var(--text-body)] text-[color:var(--color-graphite)]">
        You must be at least 18 years old to create an account.
      </p>
    </div>
  );
}
