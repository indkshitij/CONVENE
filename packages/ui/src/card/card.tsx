import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "../lib/cn";

// docs/MAIN_DESIGN.md "Components": Feature Card (bone white) and Pastel
// Category Tile (solid pastel wash) share the same shape — 32px radius,
// generous padding, no border, no shadow — and differ only by surface color.
const cardVariants = cva("rounded-[var(--radius-cards)] p-[var(--card-padding)]", {
  variants: {
    variant: {
      feature: "bg-[color:var(--color-bone-white)]",
      "pastel-lavender": "bg-[color:var(--color-lavender-wash)]",
      "pastel-mint": "bg-[color:var(--color-mint-wash)]",
      "pastel-powder": "bg-[color:var(--color-powder-blue)]",
      "pastel-solar": "bg-[color:var(--color-solar-gradient)]",
    },
  },
  defaultVariants: {
    variant: "feature",
  },
});

export type CardProps = VariantProps<typeof cardVariants> & React.HTMLAttributes<HTMLDivElement>;

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ variant }), className)} {...props} />
  ),
);

Card.displayName = "Card";
