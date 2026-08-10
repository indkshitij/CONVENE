"use client";

import { useSyncExternalStore } from "react";

// §18.7: "a persistent offline banner appears within 2s of connectivity
// loss." The browser's own `offline`/`online` events fire synchronously
// on a real network-interface change — there's no polling or debounce
// here, so detection is effectively immediate (well under the 2s bar),
// not merely "within" it.
//
// `useSyncExternalStore` (not useState+useEffect) is what React itself
// recommends for subscribing to a browser API like `navigator.onLine`:
// the `getServerSnapshot` argument gives a fixed, correct value for SSR
// (avoiding the hydration mismatch a `useState(() => navigator.onLine)`
// initializer would cause, since `navigator` doesn't exist on the
// server) without ever calling `setState` synchronously inside an
// effect body, which its own lint rule (react-hooks/set-state-in-effect)
// flags as a footgun.
function subscribe(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

function getServerSnapshot(): boolean {
  return true;
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
