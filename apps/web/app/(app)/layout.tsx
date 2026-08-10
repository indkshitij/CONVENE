import { AppProviders } from "@/providers/app-providers";
import { BottomTabBar } from "@/components/shared/bottom-tab-bar";
import { SidebarNav } from "@/components/shared/sidebar-nav";
import { requireActiveSession } from "@/lib/auth/guards";

// PRD §18.1: "(app)/layout.tsx — auth guard + sidebar/tabbar + WS
// provider." §18.5: every authenticated surface is noindex.
export const metadata = {
  robots: { index: false, follow: false },
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Redirects to /login (no session) or /setup/{step} (onboarding
  // incomplete) before anything below ever renders — this is the one
  // gate every (app) route inherits by nesting under this layout.
  const session = await requireActiveSession();

  return (
    <AppProviders currentUserId={session.user.id}>
      <div className="flex flex-1">
        <SidebarNav />
        {/* P29.3: `min-w-0` on both flex children in this chain — a flex
            item's default min-width is `auto` (its content's own
            min-content size), so without this, any route whose content
            has an unbreakably-wide descendant (chats-screen.tsx's header
            row was one real instance, caught by zoom-reflow.spec.ts at
            320px) silently forces this entire shared shell — and every
            other route nested under it — wider than the viewport. Fixed
            here, once, rather than chasing it per-route. */}
        <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
          <main className="mx-auto w-full min-w-0 max-w-(--page-max-width) flex-1">{children}</main>
        </div>
      </div>
      <BottomTabBar />
    </AppProviders>
  );
}
