import Link from "next/link";
import { AvailableFab } from "./available-fab";
import { PRIMARY_NAV_ITEMS } from "./nav-items";

// design.md §14.0: bottom tab bar, mobile only (md/768px and up switches
// to SidebarNav — see (app)/layout.tsx). Home/Discover/[FAB]/Chats/Profile.
export function BottomTabBar() {
  const [home, discover, chats, profile] = PRIMARY_NAV_ITEMS;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-10 flex h-16 items-center justify-around border-t border-[color:var(--color-mist-gray)] bg-[color:var(--surface-pure-white)] md:hidden"
    >
      <TabLink item={home!} />
      <TabLink item={discover!} />
      <AvailableFab />
      <TabLink item={chats!} />
      <TabLink item={profile!} />
    </nav>
  );
}

function TabLink({ item }: { item: { label: string; href: string } }) {
  return (
    <Link
      href={item.href}
      className="flex min-h-11 min-w-11 flex-col items-center justify-center gap-[var(--spacing-8)] px-[var(--spacing-8)] text-[length:var(--text-caption)] text-[color:var(--color-graphite)]"
    >
      {item.label}
    </Link>
  );
}
