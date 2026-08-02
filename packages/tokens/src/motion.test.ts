import { describe, expect, it } from "vitest";
import { motion, reducedMotion } from "./motion";

describe("motion (docs/design.md §15.4)", () => {
  it("defines the five named durations", () => {
    expect(motion.instant.duration).toBe("100ms");
    expect(motion.fast.duration).toBe("160ms");
    expect(motion.base.duration).toBe("240ms");
    expect(motion.slow.duration).toBe("400ms");
    expect(motion.pulse.duration).toBe("2000ms");
  });

  it("the availability pulse runs infinitely", () => {
    expect(motion.pulse.easing).toContain("infinite");
  });

  it("reduced motion zeroes durations but preserves the opacity fade exception", () => {
    expect(reducedMotion.duration).toBe("0ms");
    expect(reducedMotion.opacityFadeDuration).toBe("100ms");
  });
});
