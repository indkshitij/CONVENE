"use client";

import { create } from "zustand";

// PRD §18.3: Zustand holds only *ephemeral* UI state — "sheet/modal
// stack, theme, feature flags" plus (not named individually in that
// list, but the same kind of thing) a toast queue and per-conversation
// composer drafts. Nothing here is server data; nothing here survives
// intentionally past a reload except where explicitly persisted
// (composer drafts aren't — the message outbox, §18.3's own IndexedDB
// mechanism, is what survives a reload for actual sends; a draft that
// was never sent is fine to lose).
export type Toast = {
  id: string;
  variant: "error" | "info" | "success";
  message: string;
  // §15.7's "Not interested ... undoable via a 5s toast" is the first
  // caller needing an actionable toast (not just informational) — action
  // and durationMs are both optional so every existing pushToast call
  // keeps working unchanged.
  action?: { label: string; onClick: () => void };
  durationMs?: number;
};

export type Theme = "light" | "dark" | "system";

interface UiState {
  sheetStack: string[];
  pushSheet: (id: string) => void;
  popSheet: () => void;

  theme: Theme;
  setTheme: (theme: Theme) => void;

  featureFlags: Record<string, boolean>;
  setFeatureFlag: (key: string, value: boolean) => void;

  toasts: Toast[];
  pushToast: (toast: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;

  composerDrafts: Record<string, string>;
  setComposerDraft: (conversationId: string, draft: string) => void;
  clearComposerDraft: (conversationId: string) => void;
}

let toastCounter = 0;

export const useUiStore = create<UiState>((set, get) => ({
  sheetStack: [],
  pushSheet: (id) => set((state) => ({ sheetStack: [...state.sheetStack, id] })),
  popSheet: () => set((state) => ({ sheetStack: state.sheetStack.slice(0, -1) })),

  theme: "system",
  setTheme: (theme) => set({ theme }),

  featureFlags: {},
  setFeatureFlag: (key, value) =>
    set((state) => ({ featureFlags: { ...state.featureFlags, [key]: value } })),

  toasts: [],
  pushToast: (toast) => {
    toastCounter += 1;
    const id = `toast-${toastCounter}`;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    if (toast.durationMs) {
      setTimeout(() => get().dismissToast(id), toast.durationMs);
    }
  },
  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),

  composerDrafts: {},
  setComposerDraft: (conversationId, draft) =>
    set((state) => ({ composerDrafts: { ...state.composerDrafts, [conversationId]: draft } })),
  clearComposerDraft: (conversationId) =>
    set((state) => {
      const rest = Object.fromEntries(
        Object.entries(state.composerDrafts).filter(([id]) => id !== conversationId),
      );
      return { composerDrafts: rest };
    }),
}));

// A non-hook accessor for use outside React (QueryClient's global
// onError callback runs there — see query-provider.tsx) — Zustand
// stores expose their current state via `.getState()` regardless of
// whether anything is subscribed via the hook.
export function pushToast(toast: Omit<Toast, "id">): void {
  useUiStore.getState().pushToast(toast);
}
