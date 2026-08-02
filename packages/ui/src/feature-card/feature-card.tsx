import { forwardRef } from "react";
import { Card, type CardProps } from "../card/card";
import { cn } from "../lib/cn";

// docs/MAIN_DESIGN.md "Feature Card": Aeonik heading-sm title in --color-ink,
// Geist body copy in --color-graphite below it. Composes Card rather than
// re-declaring the surface/radius/padding rules it already owns.
export type FeatureCardProps = Omit<CardProps, "children"> & {
  title: string;
  description: string;
};

export const FeatureCard = forwardRef<HTMLDivElement, FeatureCardProps>(
  ({ title, description, className, variant, ...props }, ref) => (
    <Card ref={ref} variant={variant} className={cn(className)} {...props}>
      <h3 className="font-[family-name:var(--font-aeonik)] text-[length:var(--text-heading-sm)] font-medium text-[color:var(--color-ink)]">
        {title}
      </h3>
      <p className="mt-[var(--spacing-16)] font-[family-name:var(--font-geist)] text-[length:var(--text-body)] text-[color:var(--color-graphite)]">
        {description}
      </p>
    </Card>
  ),
);

FeatureCard.displayName = "FeatureCard";
