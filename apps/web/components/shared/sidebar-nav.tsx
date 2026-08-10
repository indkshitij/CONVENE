import Link from "next/link";
import { DESKTOP_ONLY_NAV_ITEMS, PRIMARY_NAV_ITEMS } from "./nav-items";

// design.md §14.0: "left sidebar with the same destinations plus Search
// and Settings; content max-width 1280px." Desktop only (md/768px+) —
// BottomTabBar covers mobile.
export function SidebarNav() {
  return (
    <nav
      aria-label="Primary"
      className="hidden w-56 shrink-0 flex-col gap-[var(--spacing-8)] border-r border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-32)] md:flex"
    >
      {PRIMARY_NAV_ITEMS.map((item) => (
        <SidebarLink key={item.href} item={item} />
      ))}
      <div className="my-[var(--spacing-16)] h-px bg-[color:var(--color-mist-gray)]" />
      {DESKTOP_ONLY_NAV_ITEMS.map((item) => (
        <SidebarLink key={item.href} item={item} />
      ))}
    </nav>
  );
}

function SidebarLink({ item }: { item: { label: string; href: string } }) {
  return (
    <Link
      href={item.href}
      className="min-h-11 rounded-[var(--radius-lg)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body)] text-[color:var(--color-ink)] hover:bg-[color:var(--surface-mist-section)]"
    >
      {item.label}
    </Link>
  );
}
