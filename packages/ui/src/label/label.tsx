import { forwardRef } from "react";
import { cn } from "../lib/cn";

// design.md §14.3/§14.4: "labels above inputs" (every auth screen).
export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

export const Label = forwardRef<HTMLLabelElement, LabelProps>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      "mb-[var(--spacing-8)] block font-[family-name:var(--font-geist)] text-[length:var(--text-body-sm)] font-medium text-[color:var(--color-ink)]",
      className,
    )}
    {...props}
  />
));

Label.displayName = "Label";
