import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "../lib/cn";

// docs/MAIN_DESIGN.md "Pill Tag / Chip": 9999px radius, Geist 12-14px weight
// 500, 4px/12px padding, pastel-tinted backgrounds for category labels.
const chipVariants = cva(
  "inline-flex items-center rounded-[var(--radius-tags)] px-3 py-1 font-[family-name:var(--font-geist)] font-medium text-[length:var(--text-body-sm)]",
  {
    variants: {
      tint: {
        neutral: "bg-[color:var(--color-mist-gray)] text-[color:var(--color-graphite)]",
        lavender: "bg-[color:var(--color-lavender-wash)] text-[color:var(--color-ink)]",
        mint: "bg-[color:var(--color-mint-wash)] text-[color:var(--color-ink)]",
        powder: "bg-[color:var(--color-powder-blue)] text-[color:var(--color-ink)]",
      },
    },
    defaultVariants: {
      tint: "neutral",
    },
  },
);

export type ChipProps = VariantProps<typeof chipVariants> & React.HTMLAttributes<HTMLSpanElement>;

export const Chip = forwardRef<HTMLSpanElement, ChipProps>(({ className, tint, ...props }, ref) => (
  <span ref={ref} className={cn(chipVariants({ tint }), className)} {...props} />
));

Chip.displayName = "Chip";
