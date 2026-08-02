import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeatureCard } from "./feature-card";

describe("FeatureCard", () => {
  it("renders a title and description", () => {
    render(<FeatureCard title="Declare an intent" description="Say what you're here for." />);
    expect(screen.getByRole("heading", { name: "Declare an intent" })).toBeInTheDocument();
    expect(screen.getByText("Say what you're here for.")).toBeInTheDocument();
  });

  it("passes the variant through to the underlying Card surface", () => {
    render(
      <FeatureCard
        data-testid="feature-card"
        variant="pastel-mint"
        title="Go available"
        description="A time-boxed window."
      />,
    );
    expect(screen.getByTestId("feature-card").className).toContain("mint-wash");
  });
});
