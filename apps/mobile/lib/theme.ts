// §18.8: "packages/tokens (consumed as a theme object)." Most styling
// goes through NativeWind classNames (tailwind.config.js reads the same
// @convene/tokens values) — this re-export exists for the handful of
// call sites that need a raw value directly (native component color
// props like <StatusBar>, icon fills) rather than a className.
export { colors, radius, spacing, availability, motion } from "@convene/tokens";
