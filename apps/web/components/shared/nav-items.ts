// design.md §14.0: "bottom tab bar — Home · Discover · Available (FAB,
// centre, elevated) · Chats · Profile. Notifications live in the Home
// header." / desktop: "same destinations plus Search and Settings."
// Single source of truth for both BottomTabBar and SidebarNav so the two
// surfaces can't silently drift apart.
export interface NavItem {
  label: string;
  href: string;
}

export const PRIMARY_NAV_ITEMS: readonly NavItem[] = [
  { label: "Home", href: "/home" },
  { label: "Discover", href: "/discover" },
  { label: "Chats", href: "/chats" },
  { label: "Profile", href: "/profile/edit" },
];

// Desktop-only, per §14.0's "same destinations plus Search and Settings."
export const DESKTOP_ONLY_NAV_ITEMS: readonly NavItem[] = [
  { label: "Search", href: "/search" },
  { label: "Settings", href: "/settings/account" },
];
