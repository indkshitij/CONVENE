import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[var(--spacing-16)] px-[var(--spacing-24)] py-[var(--spacing-80)] text-center">
      <h1 className="text-[length:var(--text-heading)] font-[family-name:var(--font-aeonik)] text-[color:var(--color-ink)]">
        Page not found
      </h1>
      <p className="text-[length:var(--text-body)] text-[color:var(--color-graphite)]">
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link href="/" className="text-[color:var(--color-iris-blue)]">
        Back to home
      </Link>
    </div>
  );
}
