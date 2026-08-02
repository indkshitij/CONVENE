// Transcribed from docs/design.md §15.4 "Spacing, Radius, Elevation, Motion"
// — the authenticated-product motion system. MAIN_DESIGN.md is silent on
// named motion tokens (only prose durations for its own marketing
// components), so this fills the gap per CLAUDE.md's design-authority rule.
export const motion = {
  instant: { duration: "100ms", easing: "linear" },
  fast: { duration: "160ms", easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
  base: { duration: "240ms", easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
  slow: { duration: "400ms", easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
  pulse: { duration: "2000ms", easing: "ease-in-out infinite" },
} as const;

// design.md §15.4: "prefers-reduced-motion: reduce -> all durations become
// 0ms except opacity fades (100ms), and the availability pulse becomes a
// static ring." The 0ms/100ms split is a token-level fact; turning the pulse
// into a *static ring* (rather than just a 0ms animation) is a behavioural
// decision the future Availability component must implement itself.
export const reducedMotion = {
  duration: "0ms",
  opacityFadeDuration: "100ms",
} as const;

export type MotionToken = keyof typeof motion;
