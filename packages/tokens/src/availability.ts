// Transcribed from docs/design.md §15.2 "Availability colour mapping (always
// paired with an icon and a text label)" — the authenticated-product
// availability states. MAIN_DESIGN.md has no equivalent (it's a marketing
// site with no notion of availability), so this fills the gap per
// CLAUDE.md's design-authority rule.
//
// Light/dark values are both transcribed for completeness (design.md's whole
// palette is theme-switched), but only the light values are wired into any
// active CSS today — dark mode is not yet implemented as a feature.
export const availability = {
  availableNow: {
    color: { light: "#15803D", dark: "#22C55E" },
    token: "--success-600",
    icon: "●",
    label: "Available now",
    pulsing: true,
  },
  busy: {
    color: { light: "#B45309", dark: "#F59E0B" },
    token: "--warning-600",
    icon: "◐",
    label: "Busy",
    pulsing: false,
  },
  away: {
    color: { light: "#A8A29E", dark: "#A8A29E" },
    token: "--neutral-400",
    icon: "○",
    label: "Away",
    pulsing: false,
  },
  scheduled: {
    color: { light: "#1D4ED8", dark: "#60A5FA" },
    token: "--info-600",
    icon: "📅",
    // design.md gives this as a worked example, not a fixed string —
    // the real label is generated from the user's scheduled slot.
    labelExample: "Free Thu 6 PM",
    pulsing: false,
  },
  offline: {
    color: { light: "#D6D3D1", dark: "#D6D3D1" },
    token: "--neutral-300",
    icon: "○",
    // Also a worked example — the real label is generated from last-seen time.
    labelExample: "Last seen 2h ago",
    pulsing: false,
  },
} as const;

export type AvailabilityState = keyof typeof availability;
