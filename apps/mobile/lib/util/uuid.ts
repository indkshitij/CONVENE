// Client-generated client_msg_id only needs to be unique per-device, not
// cryptographically unguessable (BR-MSG's idempotency key, not a
// security token) — a Math.random-based v4-shaped id avoids pulling in
// expo-crypto/react-native-get-random-values for this one call site.
export function randomUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
