import Link from "next/link";

// design.md §14.3: "403 suspended -> dedicated screen with the reason,
// duration and appeal link." Duration isn't part of apps/api's current
// 403 ACCOUNT_SUSPENDED error body (message text only, no structured
// expiry field) — showing whatever reason text the server sent rather
// than fabricating a duration it didn't provide.
export function SuspendedAccountScreen({ reason }: { reason: string | null }) {
  return (
    <div className="flex flex-col gap-[var(--spacing-16)] text-center">
      <h1 className="text-[length:var(--text-heading-sm)] font-[family-name:var(--font-aeonik)] text-[color:var(--color-ink)]">
        Account suspended
      </h1>
      <p className="text-[length:var(--text-body)] text-[color:var(--color-graphite)]">
        {reason ?? "This account has been suspended."}
      </p>
      <Link
        href="/appeal"
        className="text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)]"
      >
        Appeal this decision
      </Link>
    </div>
  );
}
