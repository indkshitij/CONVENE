import { describe, expect, it } from "vitest";
import { PACKAGE_NAME, colors, radius, spacing, textScale } from "./index";

describe("@convene/tokens", () => {
  it("exposes its package identity", () => {
    expect(PACKAGE_NAME).toBe("@convene/tokens");
  });

  it("matches the canvas/surface colors from docs/MAIN_DESIGN.md", () => {
    expect(colors.skyTint).toBe("#ebf5ff");
    expect(colors.boneWhite).toBe("#fafdff");
    expect(colors.charcoal).toBe("#181d27");
  });

  it("defines the full spacing scale on an 8px base unit", () => {
    expect(Object.values(spacing).every((value) => parseInt(value, 10) % 8 === 0)).toBe(true);
  });

  it("caps card radius at 32px and pills at a full 9999px", () => {
    expect(radius.cards).toBe("32px");
    expect(radius.buttonsPill).toBe("9999px");
  });

  it("never exceeds font-weight 500 in the type scale's display tier", () => {
    expect(textScale.hero.font).toBe("aeonik");
    expect(textScale.display.font).toBe("aeonik");
  });
});
