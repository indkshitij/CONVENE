import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import importPlugin from "eslint-plugin-import";
import jsxA11y from "eslint-plugin-jsx-a11y";

/**
 * Any specifier matching one of these patterns is an "app" boundary — no
 * package or other app may import across it (PRD §17.1: module boundaries
 * are enforced in code so a module can be extracted without refactoring
 * callers). Package-to-package imports (e.g. ui -> tokens) are unaffected.
 */
const APP_NAMES = ["web", "api", "realtime", "admin", "mobile"];

// Relative specifiers naming an app 1-4 directories up, e.g. "../web/x",
// "../../web/x", "../../../apps/web/x" — covers the plain-relative form a
// contributor is likely to type, in addition to the bare-specifier form
// (@convene/web) and the "apps/web" path form, since none of these are
// literal substrings of one another.
const RELATIVE_APP_PATTERNS = APP_NAMES.flatMap((name) => [
  `../${name}/**`,
  `../../${name}/**`,
  `../../../${name}/**`,
  `../../../../${name}/**`,
]);

export const APP_BOUNDARY_GROUP = [
  "@convene/web",
  "@convene/web/**",
  "@convene/api",
  "@convene/api/**",
  "@convene/realtime",
  "@convene/realtime/**",
  "@convene/admin",
  "@convene/admin/**",
  "@convene/mobile",
  "@convene/mobile/**",
  "**/apps/web/**",
  "**/apps/api/**",
  "**/apps/realtime/**",
  "**/apps/admin/**",
  "**/apps/mobile/**",
  ...RELATIVE_APP_PATTERNS,
];

/**
 * The module-boundary rules only (no plugin registration). Safe to merge into
 * any config that has already registered a plugin named "import" under that
 * key (e.g. eslint-config-next does) without triggering a "Cannot redefine
 * plugin" error.
 */
export const moduleBoundaryConfig = {
  files: ["**/*.{ts,tsx}"],
  rules: {
    "import/no-relative-packages": "error",
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: APP_BOUNDARY_GROUP,
            message:
              "Module boundary violation: apps must not import other apps, and packages must not import apps (PRD §17.1).",
          },
        ],
      },
    ],
  },
};

const baseConfig = [
  {
    ignores: ["**/dist/**", "**/.next/**", "**/.turbo/**", "**/node_modules/**", "**/coverage/**"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      import: importPlugin,
      "jsx-a11y": jsxA11y,
    },
  },
  moduleBoundaryConfig,
];

export default baseConfig;
