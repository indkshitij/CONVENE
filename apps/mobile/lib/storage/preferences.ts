import { createMMKV } from "react-native-mmkv";

// §18.8: "MMKV for preferences" — device-local UI/display preferences
// only (last-used tab, dismissed nudges, theme override). Never tokens
// (secure-tokens.ts's job) and never anything server-authoritative
// (settings synced from apps/api belong in the query cache, not here) —
// this store is allowed to be wrong/stale/wiped without breaking
// anything but a small UX convenience. `createMMKV` (not `new MMKV()`)
// is react-native-mmkv v4's Nitro-Modules-based factory API.
const storage = createMMKV({ id: "convene.preferences" });

export const preferences = {
  getString(key: string): string | null {
    return storage.getString(key) ?? null;
  },
  setString(key: string, value: string): void {
    storage.set(key, value);
  },
  getBoolean(key: string): boolean | null {
    return storage.getBoolean(key) ?? null;
  },
  setBoolean(key: string, value: boolean): void {
    storage.set(key, value);
  },
  delete(key: string): void {
    storage.remove(key);
  },
};
