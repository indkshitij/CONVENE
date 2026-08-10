// design.md §14.4: "password with a live strength meter and rule
// checklist... the password rule checklist is an ARIA live region
// announcing satisfied rules." Rules mirror packages/validation's own
// passwordSchema (10+ chars, >=1 letter, >=1 number) for *display*
// only — the actual pass/fail decision on submit still comes from
// zodResolver(registerSchema), this never re-implements that check.
const RULES = [
  { id: "length", label: "10+ characters", test: (value: string) => value.length >= 10 },
  { id: "letter", label: "Contains a letter", test: (value: string) => /[a-zA-Z]/.test(value) },
  { id: "number", label: "Contains a number", test: (value: string) => /[0-9]/.test(value) },
] as const;

export function PasswordStrength({ value }: { value: string }) {
  const satisfied = RULES.filter((rule) => rule.test(value));
  const strength = satisfied.length / RULES.length;
  const label = strength === 1 ? "Good" : strength >= 0.5 ? "Fair" : "Weak";

  return (
    <div className="mt-[var(--spacing-8)]">
      <div className="h-1 w-full overflow-hidden rounded-[var(--radius-full-2)] bg-[color:var(--color-mist-gray)]">
        <div
          className="h-full bg-[color:var(--color-iris-blue)] transition-[width]"
          style={{ width: `${strength * 100}%`, transitionDuration: "var(--motion-fast)" }}
        />
      </div>
      <p className="mt-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
        {value ? label : ""}
      </p>
      <ul
        aria-live="polite"
        className="mt-[var(--spacing-8)] flex flex-col gap-[var(--spacing-8)] text-[length:var(--text-body-sm)]"
      >
        {RULES.map((rule) => {
          const ok = rule.test(value);
          return (
            <li
              key={rule.id}
              className={
                ok ? "text-[color:var(--color-ink)]" : "text-[color:var(--color-graphite)]"
              }
            >
              {ok ? "✓" : "○"} {rule.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
