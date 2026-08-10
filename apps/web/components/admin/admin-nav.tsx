"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// design.md §14.20's left nav: "Overview, Reports, Users, Moderation,
// Appeals, Analytics, Config, Audit." Only the four sections this phase
// actually built (Overview/Reports/Moderation/Appeals) are live links —
// Users/Analytics/Config/Audit have no screen behind them yet (Audit has
// a real backend, admin-audit-logs.controller.ts, but no UI; the rest
// have neither), so they're listed but disabled rather than linking to a
// 404 or silently omitted from the nav entirely.
const NAV_ITEMS = [
  { href: "/admin", label: "Overview", enabled: true },
  { href: "/admin/reports", label: "Reports", enabled: true },
  { href: "#", label: "Users", enabled: false },
  { href: "/admin/moderation", label: "Moderation", enabled: true },
  { href: "/admin/appeals", label: "Appeals", enabled: true },
  { href: "#", label: "Analytics", enabled: false },
  { href: "/admin/config", label: "Config", enabled: true },
  { href: "#", label: "Audit", enabled: false },
] as const;

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Admin"
      className="w-48 shrink-0 border-r border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-24)]"
    >
      <ul className="flex flex-col gap-[var(--spacing-8)]">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.enabled &&
            (pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href)));
          return (
            <li key={item.label}>
              {item.enabled ? (
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`block min-h-11 rounded-[var(--radius-inputs)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)] ${
                    isActive
                      ? "bg-[color:var(--color-mist-gray)] font-[family-name:var(--font-geist)] font-medium text-[color:var(--color-ink)]"
                      : "text-[color:var(--color-graphite)]"
                  }`}
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className="block min-h-11 cursor-not-allowed px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-fog)]"
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
