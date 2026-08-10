import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin/admin-nav";
import { requireAdminSession } from "@/lib/auth/guards";
import { AppProviders } from "@/providers/app-providers";

// PRD §18.1: "(admin)/admin/… — role-gated at the layout level."
// §18.2: "Admin — Client only, noindex. Not indexable, desktop-only."
// requireAdminSession() (P26.1) checks session.user.role against
// packages/db's admin+moderator roles — this is a UX gate only (a
// non-admin never sees the admin shell to begin with); the real
// enforcement is server-side (RolesGuard reading AuthContext.role from
// the JWT on every apps/api admin controller), same as it always was.
export const metadata = {
  robots: { index: false, follow: false },
};

// design.md §14.20's top bar shows an "MFA ✔" indicator — no MFA system
// exists anywhere in this codebase (no mfa table, no verification flow),
// so fabricating a static checkmark would misrepresent account security
// state; omitted rather than faked, documented here per CLAUDE.md's
// "flag the assumption" rule.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdminSession();
  if (session.user.status === "suspended" || session.user.status === "deleted") redirect("/login");
  return (
    <AppProviders>
      <div className="flex min-h-full flex-col">
        <header className="flex min-h-11 items-center justify-between border-b border-[color:var(--color-mist-gray)] px-[var(--spacing-24)] py-[var(--spacing-16)]">
          <span className="text-[length:var(--text-body-sm)] font-medium text-[color:var(--color-ink)]">
            Convene Admin
          </span>
          <span className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
            {session.user.full_name} · {session.user.role}
          </span>
        </header>
        <div className="flex flex-1">
          <AdminNav />
          <main className="flex flex-1">{children}</main>
        </div>
      </div>
    </AppProviders>
  );
}
