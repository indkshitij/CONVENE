"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { pushToast } from "@/stores/ui";
import { RealtimeSocket, type ConnectionStatus } from "@/lib/realtime/socket";

interface RealtimeContextValue {
  socket: RealtimeSocket | null;
  status: ConnectionStatus;
}

const RealtimeContext = createContext<RealtimeContextValue>({ socket: null, status: "idle" });

// Feature code (e.g. a future chat window, P23.2) calls
// `useRealtimeSocket().socket?.subscribe("conversation", id)` — this
// phase only stands the connection up and wires it into the Query
// cache/Zustand stores via handlers.ts; no feature yet needs to
// subscribe to anything beyond the auto-subscribed rt:user channel.
export function useRealtimeSocket(): RealtimeContextValue {
  return useContext(RealtimeContext);
}

// currentUserId is passed down from (app)/layout.tsx (a Server
// Component that already calls requireActiveSession()) rather than read
// client-side — the session cookies are httpOnly (P19.1), so client JS
// has no other way to know who's logged in.
export function RealtimeProvider({
  currentUserId,
  children,
}: {
  currentUserId: string;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ConnectionStatus>("idle");

  // Construction is pure (no connecting yet) so it's safe to do in
  // useMemo rather than an effect — the actual side effect (opening the
  // connection) is the effect below, which only runs `connect()`/
  // `close()`, never `setState` synchronously in its own body (statuses
  // update asynchronously from the socket's own event callbacks, which
  // is the pattern react-hooks/set-state-in-effect wants).
  const socket = useMemo(
    () =>
      new RealtimeSocket({
        queryClient,
        getCurrentUserId: () => currentUserId,
        onStatusChange: setStatus,
        onResyncRequired: () => {
          // §17.5: the buffered backlog is gone — invalidate broadly
          // rather than guess which entities were affected.
          void queryClient.invalidateQueries();
          pushToast({ variant: "info", message: "Reconnected — refreshing the latest data." });
        },
      }),
    [queryClient, currentUserId],
  );

  useEffect(() => {
    void socket.connect();
    return () => socket.close();
  }, [socket]);

  return <RealtimeContext.Provider value={{ socket, status }}>{children}</RealtimeContext.Provider>;
}
