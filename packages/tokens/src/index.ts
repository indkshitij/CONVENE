export const PACKAGE_NAME = "@convene/tokens" as const;

export { colors, gradients, surfaces } from "./colors";
export type { ColorToken } from "./colors";

export { fontFamily, fontWeight, textScale } from "./typography";
export type { TextScaleToken } from "./typography";

export { spacing, layout } from "./spacing";
export type { SpacingToken } from "./spacing";

export { radius, shadow } from "./radius";
export type { RadiusToken } from "./radius";

export { availability } from "./availability";
export type { AvailabilityState } from "./availability";

export { motion, reducedMotion } from "./motion";
export type { MotionToken } from "./motion";
