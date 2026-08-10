"use client";

import { useUiStore } from "@/stores/ui";

const VARIANT_BG: Record<string, string> = {
  error: "var(--color-charcoal)",
  info: "var(--color-iris-blue)",
  success: "var(--color-charcoal)",
};

// Renders whatever query-provider.tsx's global onError (or any other
// caller) pushed via stores/ui.ts's `pushToast`. Mounted at the root
// layout (not just (app)) since errors can happen on unauthenticated
// surfaces too (e.g. a failed login request).
export function ToastViewport() {
  const toasts = useUiStore((state) => state.toasts);
  const dismissToast = useUiStore((state) => state.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-[var(--spacing-16)] left-1/2 z-30 flex -translate-x-1/2 flex-col gap-[var(--spacing-8)]">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="alert"
          className="flex items-center gap-[var(--spacing-16)] rounded-[var(--radius-lg)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)] shadow-[var(--shadow-lg)]"
          style={{ backgroundColor: VARIANT_BG[toast.variant] }}
        >
          <span>{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                toast.action!.onClick();
                dismissToast(toast.id);
              }}
              className="min-h-11 shrink-0 font-medium underline"
            >
              {toast.action.label}
            </button>
          )}
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            aria-label="Dismiss"
            className="min-h-11 min-w-11"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
