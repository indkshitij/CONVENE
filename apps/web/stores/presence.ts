"use client";

import { create } from "zustand";

// PRD §18.3: "presence map" is Zustand's, not Query's — presence is a
// continuously-updating, ephemeral signal (§10.3.10's realtime channel),
// not a resource with a REST representation the cache would ever fetch
// on its own. lib/realtime/handlers.ts is the only writer — this store
// has no fetch of its own.
export interface PresenceEntry {
  online: boolean;
  lastSeenAt: string | null;
}

interface PresenceState {
  byUserId: Record<string, PresenceEntry>;
  setPresence: (userId: string, entry: PresenceEntry) => void;
  clear: () => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  byUserId: {},
  setPresence: (userId, entry) =>
    set((state) => ({ byUserId: { ...state.byUserId, [userId]: entry } })),
  clear: () => set({ byUserId: {} }),
}));
