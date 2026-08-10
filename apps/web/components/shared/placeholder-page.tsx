export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-[var(--spacing-16)] px-[var(--spacing-24)] py-[var(--spacing-40)]">
      <h1 className="text-[length:var(--text-heading-sm)] font-[family-name:var(--font-aeonik)] text-[color:var(--color-ink)]">
        {title}
      </h1>
      <p className="text-[length:var(--text-body)] text-[color:var(--color-graphite)]">
        {description}
      </p>
    </div>
  );
}
