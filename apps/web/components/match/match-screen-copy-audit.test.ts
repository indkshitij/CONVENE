import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// P22.2's own explicit testing bullet: "A copy audit step: grep the
// screen's strings for attraction-adjacent language and fail on a
// documented deny-list." design.md §14.9: "Explicitly not a
// swipe-for-attraction UX."
//
// The deny-list scans only the component's JSX return body (comments and
// identifiers above it are excluded) — this file's own sibling
// (match-screen.tsx) legitimately uses words like "swipe" repeatedly in
// its *comments* to explain why swipe is disabled, which would false-
// positive a whole-file scan.
const DENY_LIST = [
  "swipe",
  "match!",
  "it's a match",
  "hot",
  "cute",
  "attractive",
  "dating",
  "crush",
  "chemistry",
  "spark",
  " like ",
  "wink",
  "flirt",
];

describe("match screen copy audit", () => {
  it("the rendered UI strings contain no attraction-adjacent, dating-app language", () => {
    const filePath = path.resolve(process.cwd(), "components/match/match-screen.tsx");
    const source = readFileSync(filePath, "utf8");
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const jsxStart = withoutComments.indexOf("return (");
    const jsx = jsxStart >= 0 ? withoutComments.slice(jsxStart) : withoutComments;
    const lowered = jsx.toLowerCase();

    for (const term of DENY_LIST) {
      expect(
        lowered,
        `found deny-listed term "${term}" in the match screen's rendered copy`,
      ).not.toContain(term);
    }
  });
});
