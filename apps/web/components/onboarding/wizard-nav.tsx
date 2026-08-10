import Link from "next/link";

// design.md §14.6 shared chrome: "Back, Continue, Skip for now (only
// where permitted)." `Continue` is each step's own form submit button
// (it has to trigger that form's commit-before-advance, so it can't be
// a generic shared component) — this is only the two navigation-only
// pieces. `skipHref` is omitted entirely (not just hidden) on any step
// §10.1 doesn't permit skipping, so there's no path to render a
// forbidden skip affordance by mistake.
export function WizardNav({ backHref, skipHref }: { backHref: string | null; skipHref?: string }) {
  return (
    <div className="mt-[var(--spacing-16)] flex items-center justify-between text-[length:var(--text-body-sm)]">
      {backHref ? (
        <Link
          href={backHref}
          className="min-h-11 content-center text-[color:var(--color-graphite)] underline"
        >
          Back
        </Link>
      ) : (
        <span />
      )}
      {skipHref && (
        <Link
          href={skipHref}
          className="min-h-11 content-center text-[color:var(--color-graphite)] underline"
        >
          Skip for now
        </Link>
      )}
    </div>
  );
}
