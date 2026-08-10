import * as Haptics from "expo-haptics";

// §18.8: "Haptics on availability toggle and message send" — the only
// two trigger points named, so the only two exported here rather than a
// generic wrapper other screens reach for on their own judgment.
export function hapticAvailabilityToggle(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

export function hapticMessageSent(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}
