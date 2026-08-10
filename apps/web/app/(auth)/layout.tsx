// PRD §18.1: "(auth)/layout.tsx — centred card shell." §18.5: auth
// screens are excluded from indexing the same as authenticated surfaces
// (there's nothing to index and no reason to invite crawlers to a
// login/signup form).
export const metadata = {
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-[var(--spacing-24)] py-[var(--spacing-40)]">
      <div className="w-full max-w-sm rounded-[var(--radius-cards)] bg-[color:var(--surface-paper-card)] p-[var(--spacing-32)] shadow-[var(--shadow-subtle)]">
        {children}
      </div>
    </main>
  );
}
