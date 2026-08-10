// Mirrors css/variables.css — see docs/MAIN_DESIGN.md "Tokens — Colors".
export const colors = {
  skyTint: "#ebf5ff",
  paperWhite: "#ffffff",
  boneWhite: "#fafdff",
  mistGray: "#f6f7f8",
  ink: "#0a0d12",
  charcoal: "#181d27",
  graphite: "#535862",
  fog: "#93979f",
  slateShadow: "#3b3d41",
  irisBlue: "#0069e0",
  skyBlue: "#0099ff",
  lavenderWash: "#f1e6ff",
  mintWash: "#d3f6e3",
  powderBlue: "#cce7ff",
  solarGradient: "#fff2be",
  violetGradient: "#e4ccff",
  aquaGradient: "#c2e9ff",
  peachGradient: "#ffd1b8",
  // docs/design.md §15 (authenticated-product design system, a separate
  // token source from MAIN_DESIGN.md above) — `--danger-600`/`--danger-100`
  // light-mode values. P20.1 is the first screen (auth forms) explicitly
  // governed by design.md rather than MAIN_DESIGN.md, and needed an error
  // color that didn't exist anywhere in this file yet.
  dangerText: "#b91c1c",
  dangerTint: "#fee2e2",
  // docs/design.md §15's `--warning-600`/`--warning-100` light-mode
  // values. `--availability-busy` (availability.ts) already equals
  // `--warning-600`'s hex, so only the tint (banner background) is new
  // here — P21.1's T-5min expiring-soon banner is the first UI that
  // needs a warning surface, not just a warning text/icon color.
  warningTint: "#fef3c7",
} as const;

export const gradients = {
  irisBlue: "linear-gradient(rgb(71, 157, 255) 11.43%, rgb(0, 105, 224) 78.2%)",
  solarGradient: "linear-gradient(rgb(255, 249, 224) 0%, rgb(255, 236, 163) 100%)",
  violetGradient: "linear-gradient(rgb(244, 235, 255) 0%, rgb(228, 204, 255) 100%)",
  aquaGradient: "linear-gradient(rgb(229, 246, 255) 0%, rgb(194, 233, 255) 100%)",
  peachGradient: "linear-gradient(rgb(255, 242, 235) 0%, rgb(255, 209, 184) 100%)",
} as const;

export const surfaces = {
  skyCanvas: "#ebf5ff",
  paperCard: "#fafdff",
  pureWhite: "#ffffff",
  mistSection: "#f6f7f8",
} as const;

export type ColorToken = keyof typeof colors;
