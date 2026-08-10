export function AuthCardHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h1 className="text-[length:var(--text-heading-sm)] font-[family-name:var(--font-aeonik)] text-[color:var(--color-ink)]">
        {title}
      </h1>
      <p className="mt-[var(--spacing-8)] text-[length:var(--text-body)] text-[color:var(--color-graphite)]">
        {subtitle}
      </p>
    </div>
  );
}
