"use client";

// Error boundaries must be Client Components. Next.js 16.2 renamed the
// primary recovery prop from `reset` to `unstable_retry` (re-fetches and
// re-renders the segment, unlike `reset()` which only clears local error
// state) — confirmed against node_modules' own docs for this exact
// installed version, since this differs from older Next releases.
interface RouteErrorProps {
  error: Error & { digest?: string };
  unstable_retry: () => void;
  title?: string;
}

export function RouteError({ unstable_retry, title = "Something went wrong" }: RouteErrorProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[var(--spacing-16)] px-[var(--spacing-24)] py-[var(--spacing-80)] text-center">
      <h2 className="text-[length:var(--text-heading)] font-[family-name:var(--font-aeonik)] text-[color:var(--color-ink)]">
        {title}
      </h2>
      <p className="text-[length:var(--text-body)] text-[color:var(--color-graphite)]">
        Something on our end went wrong loading this page.
      </p>
      <button
        type="button"
        onClick={() => unstable_retry()}
        className="min-h-11 rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-8 py-3 text-[length:var(--text-body)] text-[color:var(--color-paper-white)]"
      >
        Try again
      </button>
    </div>
  );
}
