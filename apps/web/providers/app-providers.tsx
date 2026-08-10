"use client";

import { NuqsAdapter } from "nuqs/adapters/next/app";
import { OfflineBanner } from "@/components/shared/offline-banner";
import { QueryProvider } from "./query-provider";
import { RealtimeProvider } from "./realtime-provider";

// PRD §18.1: `providers/*`, the composition root (app)/layout.tsx mounts
// into. P19.2 fills in the two providers P19.1 deferred here: the Query
// client (§18.3's server-data cache) and the WebSocket connection
// (§18.3's "never owns data" rule — handlers.ts is what actually applies
// events to state, this only stands the connection up).
//
// `currentUserId` is optional because AppProviders is also usable for
// surfaces that don't have an authenticated session yet in this
// codebase's current route tree — in practice (app)/layout.tsx is the
// only caller today, and it always has one (requireActiveSession()
// already redirected otherwise), but the type stays honest rather than
// asserting non-null.
export function AppProviders({
  currentUserId,
  children,
}: {
  currentUserId?: string;
  children: React.ReactNode;
}) {
  return (
    <NuqsAdapter>
      <QueryProvider>
        {currentUserId ? (
          <RealtimeProvider currentUserId={currentUserId}>
            <OfflineBanner />
            {children}
          </RealtimeProvider>
        ) : (
          <>
            <OfflineBanner />
            {children}
          </>
        )}
      </QueryProvider>
    </NuqsAdapter>
  );
}
