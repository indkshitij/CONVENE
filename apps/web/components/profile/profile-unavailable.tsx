import Link from "next/link";

// design.md §14.14's error-state row: "404 -> 'This profile isn't
// available'. 403 private/blocked -> generic, identical copy for both
// (no signal leaked)." app/api/profile/[userId]/route.ts and
// lib/profile/fetch-profile.ts's fetchProfileById already collapse
// nonexistent/private/blocked into one outcome server-side — this is
// the one render for all three, so there is nothing left here that
// could branch on which case it actually was.
export function ProfileUnavailable() {
  return (
    <div className="flex flex-col items-center gap-[var(--spacing-16)] px-[var(--spacing-24)] py-[var(--spacing-64)] text-center">
      <h1 className="text-[length:var(--text-heading-sm)] font-[family-name:var(--font-aeonik)] text-[color:var(--color-ink)]">
        This profile isn&apos;t available
      </h1>
      <Link
        href="/home"
        className="min-h-11 rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-8 py-3 text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)]"
      >
        Back to home
      </Link>
    </div>
  );
}
