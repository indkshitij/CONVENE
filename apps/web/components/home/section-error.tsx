// design.md §14.7: "Error: Per-section error with inline retry; one
// failing section never blanks the screen." Presentational only — each
// section's own Client Component supplies onRetry (its Query's refetch),
// keeping the retry mechanism local to whichever section actually failed.
export function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]"
    >
      <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-[var(--spacing-8)] min-h-11 text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)] underline"
      >
        Try again
      </button>
    </div>
  );
}
