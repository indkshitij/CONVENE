// Mirrors css/variables.css — see docs/MAIN_DESIGN.md "Tokens — Spacing & Shapes".
export const spacing = {
  8: "8px",
  16: "16px",
  24: "24px",
  32: "32px",
  40: "40px",
  48: "48px",
  56: "56px",
  64: "64px",
  80: "80px",
  88: "88px",
  120: "120px",
  160: "160px",
} as const;

export const layout = {
  pageMaxWidth: "1200px",
  sectionGap: "80px",
  cardPadding: "40px",
  elementGap: "24px",
} as const;

export type SpacingToken = keyof typeof spacing;
