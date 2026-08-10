// Next.js 16: `params` is a Promise (see AGENTS.md — this version's App
// Router APIs differ from older training data; confirmed against
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md).
export default async function LegalDocumentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const title = slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return (
    <main className="flex flex-1 flex-col px-[var(--spacing-24)] py-[var(--spacing-80)]">
      <div className="mx-auto w-full max-w-(--page-max-width)">
        <h1 className="text-[length:var(--text-display)] font-[family-name:var(--font-aeonik)] text-[color:var(--color-ink)]">
          {title}
        </h1>
        <p className="mt-[var(--spacing-24)] text-[length:var(--text-body)] text-[color:var(--color-graphite)]">
          This document isn&apos;t published yet.
        </p>
      </div>
    </main>
  );
}
