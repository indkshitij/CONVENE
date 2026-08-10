import type { DiscoveryEmptyStateReason } from "@/lib/api/client";

// PRD §11.9's four named empty-state reasons (discovery.controller.ts's
// own comment) — real, structured reasons the server derived, not a
// generic "nothing here" message. Convene Hours (design.md's own
// no-supply copy mentions "next Convene Hour... Schedule a window")
// aren't built yet (matching.service.ts's own gap comment) — omitted
// rather than referencing a feature that doesn't exist. Moved here from
// components/home/ in P22.1 once the discover feed page became this
// function's second consumer (P21.2's home sections were the first).
export function discoveryEmptyStateCopy(
  reason: DiscoveryEmptyStateReason,
  context: "available_now" | "top_matches" | "discover_feed",
): string {
  switch (reason) {
    case "no_supply":
      return context === "available_now"
        ? "No one nearby is free right now."
        : "No matches nearby yet — check back soon.";
    case "all_filtered":
      return "No matches right now — try widening your search.";
    case "all_seen":
      return "You've seen everyone for now — check back later.";
    case "profile_incomplete":
      return "Finish your profile to start seeing matches.";
  }
}
