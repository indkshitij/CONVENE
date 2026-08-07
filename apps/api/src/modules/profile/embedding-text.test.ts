import { describe, expect, it } from "vitest";
import { composeEmbeddingText, hashSourceText } from "./embedding-text";

describe("composeEmbeddingText", () => {
  it("joins the five composed fields with skills flattened to a comma list", () => {
    const text = composeEmbeddingText({
      headline: "Senior Engineer",
      about: "I build things.",
      jobTitle: "Staff Engineer",
      industry: "Software",
      skills: ["React", "Node"],
    });
    expect(text).toBe("Senior Engineer\nStaff Engineer\nSoftware\nI build things.\nReact, Node");
  });

  it("omits null/empty fields entirely rather than leaving blank lines", () => {
    const text = composeEmbeddingText({
      headline: "Senior Engineer",
      about: null,
      jobTitle: null,
      industry: null,
      skills: [],
    });
    expect(text).toBe("Senior Engineer");
  });

  it("produces an empty string for an entirely bare profile", () => {
    expect(
      composeEmbeddingText({
        headline: null,
        about: null,
        jobTitle: null,
        industry: null,
        skills: [],
      }),
    ).toBe("");
  });
});

describe("hashSourceText", () => {
  it("is deterministic for identical text", () => {
    expect(hashSourceText("hello")).toBe(hashSourceText("hello"));
  });

  it("differs for different text", () => {
    expect(hashSourceText("hello")).not.toBe(hashSourceText("hello world"));
  });
});
