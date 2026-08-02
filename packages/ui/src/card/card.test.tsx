import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "./card";

describe("Card", () => {
  it("renders children", () => {
    render(<Card>Feature content</Card>);
    expect(screen.getByText("Feature content")).toBeInTheDocument();
  });

  it("defaults to the feature (bone white) surface", () => {
    render(<Card data-testid="card">Content</Card>);
    expect(screen.getByTestId("card").className).toContain("bone-white");
  });

  it("switches surface per pastel variant", () => {
    render(
      <Card data-testid="card" variant="pastel-mint">
        Content
      </Card>,
    );
    expect(screen.getByTestId("card").className).toContain("mint-wash");
  });
});
