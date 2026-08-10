import { SectionHeader } from "@convene/ui";

// PRD §18.1 (marketing)/pricing — placeholder: the plan/entitlement
// content itself is billing's own scope (Phase 24/25), not this phase's.
export default function PricingPage() {
  return (
    <main className="flex flex-1 flex-col items-center px-[var(--spacing-24)] py-[var(--spacing-80)]">
      <div className="mx-auto flex w-full max-w-(--page-max-width) flex-col items-center gap-[var(--spacing-40)]">
        <SectionHeader
          size="display"
          title="Pricing"
          subtitle="Plans and pricing details are coming soon."
        />
      </div>
    </main>
  );
}
