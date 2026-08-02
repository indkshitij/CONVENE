import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./button";

describe("Button", () => {
  it("renders a native button by default", () => {
    render(<Button>Sign up</Button>);
    expect(screen.getByRole("button", { name: "Sign up" })).toBeInTheDocument();
  });

  it("renders an anchor when given an href", () => {
    render(<Button href="/discover">Discover</Button>);
    const link = screen.getByRole("link", { name: "Discover" });
    expect(link).toHaveAttribute("href", "/discover");
  });

  it("fires onClick for the button variant", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Sign up</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Sign up" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disables interaction when disabled", () => {
    render(<Button disabled>Sign up</Button>);
    expect(screen.getByRole("button", { name: "Sign up" })).toBeDisabled();
  });
});
