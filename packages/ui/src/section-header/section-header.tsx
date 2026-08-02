import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

// docs/MAIN_DESIGN.md "Section Header": Aeonik 48-72px weight 500, centered,
// with a Geist 18px subhead below. Letter-spacing tightens with size.
const headlineVariants = cva(
  "font-[family-name:var(--font-aeonik)] font-medium text-[color:var(--color-ink)]",
  {
    variants: {
      size: {
        heading: "text-[length:var(--text-heading-lg)] tracking-[var(--tracking-heading-lg)]",
        display: "text-[length:var(--text-display)] tracking-[var(--tracking-display)]",
      },
    },
    defaultVariants: {
      size: "heading",
    },
  },
);

export type SectionHeaderProps = VariantProps<typeof headlineVariants> & {
  title: string;
  subtitle?: string;
  className?: string;
};

export function SectionHeader({ title, subtitle, size, className }: SectionHeaderProps) {
  return (
    <div className={cn("text-center", className)}>
      <h2 className={headlineVariants({ size })}>{title}</h2>
      {subtitle !== undefined && (
        <p className="mt-[var(--spacing-16)] font-[family-name:var(--font-geist)] text-[length:var(--text-body-lg)] text-[color:var(--color-graphite)]">
          {subtitle}
        </p>
      )}
    </div>
  );
}
