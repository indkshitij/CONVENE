const { colors, radius, spacing } = require("@convene/tokens");

// §18.8: "packages/tokens (consumed as a theme object) ... styling
// (NativeWind, no CSS variables)." Web reads these same values as CSS
// custom properties (packages/tokens/css/variables.css); mobile has no
// CSS variable mechanism, so NativeWind's tailwind.config.js theme is
// the one place these plain JS objects become the actual source of
// truth for both platforms without a second, hand-maintained copy.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./lib/**/*.{js,jsx,ts,tsx}",
    "../../packages/ui/src/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: Object.fromEntries(
        Object.entries(colors).map(([key, value]) => [toKebabCase(key), value]),
      ),
      spacing: Object.fromEntries(
        Object.entries(spacing).map(([key, value]) => [String(key), value]),
      ),
      borderRadius: Object.fromEntries(
        Object.entries(radius).map(([key, value]) => [toKebabCase(key), value]),
      ),
    },
  },
  plugins: [],
};

function toKebabCase(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}
