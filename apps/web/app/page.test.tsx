import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Home from "./page";

describe("Home", () => {
  it("renders the headline", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { name: "Networking, in real time" })).toBeInTheDocument();
  });

  it("renders a primary CTA linking to /discover", () => {
    render(<Home />);
    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/discover");
  });

  it("renders all three feature cards", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { name: "Declare an intent" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Go available" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Connect and converse" })).toBeInTheDocument();
  });
});
