// Mirrors css/variables.css — see docs/MAIN_DESIGN.md "Tokens — Typography".
export const fontFamily = {
  aeonik:
    '"Aeonik", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  geist:
    '"Geist", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
} as const;

export const fontWeight = {
  medium: 500,
  semibold: 600,
} as const;

// Aeonik is the display/heading face (weight fixed at 500, never bolder);
// Geist is the UI/body face (500 workhorse, 600 only for 10px micro-labels).
export const textScale = {
  caption: { size: "10px", lineHeight: 1.4, letterSpacing: "-0.1px", font: "geist" },
  bodySm: { size: "14px", lineHeight: 1.14, letterSpacing: "-0.14px", font: "geist" },
  body: { size: "16px", lineHeight: 1.35, letterSpacing: undefined, font: "geist" },
  bodyLg: { size: "18px", lineHeight: 1.33, letterSpacing: "-0.18px", font: "geist" },
  subheading: { size: "20px", lineHeight: 1.4, letterSpacing: "-0.2px", font: "geist" },
  headingSm: { size: "24px", lineHeight: 1.17, letterSpacing: "-0.48px", font: "aeonik" },
  heading: { size: "32px", lineHeight: 1.25, letterSpacing: "-0.64px", font: "aeonik" },
  headingLg: { size: "48px", lineHeight: 1.17, letterSpacing: "-0.96px", font: "aeonik" },
  display: { size: "72px", lineHeight: 1.11, letterSpacing: "-1.44px", font: "aeonik" },
  hero: { size: "148px", lineHeight: 1.05, letterSpacing: "-2.96px", font: "aeonik" },
} as const;

export type TextScaleToken = keyof typeof textScale;
