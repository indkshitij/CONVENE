import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SectionHeader } from "./section-header";

describe("SectionHeader", () => {
  it("renders the title as a heading", () => {
    render(<SectionHeader title="Meet in real time" />);
    expect(screen.getByRole("heading", { name: "Meet in real time" })).toBeInTheDocument();
  });

  it("renders an optional subtitle", () => {
    render(<SectionHeader title="Title" subtitle="Supporting copy" />);
    expect(screen.getByText("Supporting copy")).toBeInTheDocument();
  });

  it("omits the subtitle paragraph when none is given", () => {
    render(<SectionHeader title="Title" />);
    expect(screen.queryByText("Supporting copy")).not.toBeInTheDocument();
  });
});
