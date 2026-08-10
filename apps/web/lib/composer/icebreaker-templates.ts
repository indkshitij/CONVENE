// design.md §14.10: "AI icebreaker carousel (3 options, tappable to
// insert, then editable)... labelled types (specific-observation /
// shared-context / direct-ask)." apps/api/src/modules/ai-gateway is an
// empty module skeleton (`@Module({})`, P3.1's own placeholder) — no
// generation endpoint exists anywhere in this codebase. design.md's own
// state table already names the fallback for exactly this situation:
// "Empty: AI unavailable → three curated template prompts instead,
// labelled as templates." Since AI generation doesn't exist at all
// (not "currently down" — never built), that fallback is this
// composer's only implementation, not a transient error branch. These
// are plain templates, never labelled or styled as AI-generated (no
// violet shimmer), because they honestly aren't.
export interface IcebreakerTemplate {
  type: "specific_observation" | "shared_context" | "direct_ask";
  label: string;
  build: (context: {
    recipientName: string;
    recipientHeadline: string | null;
    intentLabel: string;
  }) => string;
}

export const ICEBREAKER_TEMPLATES: IcebreakerTemplate[] = [
  {
    type: "specific_observation",
    label: "Specific observation",
    build: ({ recipientName, recipientHeadline }) =>
      recipientHeadline
        ? `I noticed you're ${recipientHeadline.toLowerCase()} — would love to hear more about that.`
        : `I came across your profile, ${recipientName}, and wanted to reach out.`,
  },
  {
    type: "shared_context",
    label: "Shared context",
    build: ({ intentLabel }) =>
      `We're both focused on ${intentLabel.toLowerCase()} right now — thought it'd be worth connecting.`,
  },
  {
    type: "direct_ask",
    label: "Direct ask",
    build: ({ intentLabel }) =>
      `Would you be open to a short chat about ${intentLabel.toLowerCase()}?`,
  },
];
