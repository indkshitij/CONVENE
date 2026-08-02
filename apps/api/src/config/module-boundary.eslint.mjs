// PRD §17.1: "each module exposes a service interface; cross-module imports
// of repositories are blocked by an ESLint boundary rule." A module may
// import another module's *.service, never its *.repository. Same
// pattern-matching technique as the repo-wide app-boundary rule in
// @convene/config/eslint.base.mjs (path patterns per name, since
// no-restricted-imports matches specifier text, not resolved paths).
//
// Lives under src/ (not beside the root eslint.config.mjs that consumes it)
// so both the config and its test can import it without crossing apps/api's
// tsc rootDir boundary.
export const MODULE_NAMES = [
  "auth",
  "profile",
  "availability",
  "intents",
  "matching",
  "connections",
  "messaging",
  "notifications",
  "trust-safety",
  "billing",
  "search",
  "ai-gateway",
  "admin",
];

export const REPOSITORY_IMPORT_PATTERNS = MODULE_NAMES.flatMap((name) => [
  `**/modules/${name}/*.repository`,
  `**/modules/${name}/**/*.repository`,
  `../${name}/*.repository`,
  `../../${name}/*.repository`,
  `../../../${name}/*.repository`,
]);

export const moduleBoundaryConfig = {
  files: ["src/modules/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: REPOSITORY_IMPORT_PATTERNS,
            message:
              "Module boundary violation: import another module's *.service, never its *.repository (PRD §17.1).",
          },
        ],
      },
    ],
  },
};
