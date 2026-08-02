import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Chip } from "./chip";

describe("Chip", () => {
  it("renders its label", () => {
    render(<Chip>Cofounder</Chip>);
    expect(screen.getByText("Cofounder")).toBeInTheDocument();
  });

  it("defaults to the neutral tint", () => {
    render(<Chip data-testid="chip">Label</Chip>);
    expect(screen.getByTestId("chip").className).toContain("mist-gray");
  });

  it("applies a pastel tint when requested", () => {
    render(
      <Chip data-testid="chip" tint="lavender">
        Label
      </Chip>,
    );
    expect(screen.getByTestId("chip").className).toContain("lavender-wash");
  });
});
