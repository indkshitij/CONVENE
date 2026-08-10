import Link from "next/link";

// design.md §14.20's "Overview" nav item — a real dashboard (queue
// counts, SLA breach summary) would need aggregate endpoints that don't
// exist yet (only the per-queue GETs P26.1 added); this is an honest
// index into the three queues that are real today rather than a
// fabricated summary.
export default function AdminOverviewPage() {
  return (
    <div className="flex-1 px-[var(--spacing-24)] py-[var(--spacing-24)]">
      <h1 className="mb-[var(--spacing-16)] text-[length:var(--text-heading-sm)] font-medium text-[color:var(--color-ink)]">
        Admin
      </h1>
      <ul className="flex flex-col gap-[var(--spacing-8)]">
        <li>
          <Link
            href="/admin/reports"
            className="text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)]"
          >
            Reports queue
          </Link>
        </li>
        <li>
          <Link
            href="/admin/moderation"
            className="text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)]"
          >
            Ban approvals
          </Link>
        </li>
        <li>
          <Link
            href="/admin/appeals"
            className="text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)]"
          >
            Appeals review
          </Link>
        </li>
        <li>
          <Link
            href="/admin/config"
            className="text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)]"
          >
            Matching weights
          </Link>
        </li>
      </ul>
    </div>
  );
}
