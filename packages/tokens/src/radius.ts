// Mirrors css/variables.css — see docs/MAIN_DESIGN.md "Border Radius".
export const radius = {
  tags: "9999px",
  cards: "32px",
  images: "24px",
  inputs: "16px",
  buttons: "32px",
  cardsSmall: "16px",
  buttonsPill: "9999px",
} as const;

export const shadow = {
  lg: "rgba(4, 69, 144, 0.08) 0px 14px 20px 4px",
  subtle: "rgba(10, 13, 18, 0.8) 0px 1px 2px 0px, rgb(10, 13, 18) 0px 0px 0px 1px",
} as const;

export type RadiusToken = keyof typeof radius;
