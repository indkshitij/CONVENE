import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "../lib/cn";

// docs/MAIN_DESIGN.md "Components": Primary CTA Button, Secondary CTA Button,
// Ghost Nav Link. Each variant's exact colors/radius/padding/type are
// transcribed from that spec, not invented here.
const buttonVariants = cva(
  "inline-flex items-center justify-center font-[family-name:var(--font-geist)] font-medium tracking-[-0.01em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-iris-blue)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none min-h-11",
  {
    variants: {
      variant: {
        primary:
          "bg-[color:var(--color-charcoal)] text-[color:var(--color-paper-white)] rounded-[var(--radius-buttons)] px-8 py-3 text-[length:var(--text-body)] shadow-[var(--shadow-subtle)]",
        secondary:
          "bg-[color:var(--color-charcoal)] text-[color:var(--color-paper-white)] rounded-[var(--radius-inputs)] px-4 py-2 text-[length:var(--text-body-sm)]",
        ghost:
          "bg-transparent text-[color:var(--color-ink)] hover:text-[color:var(--color-graphite)] rounded-[var(--radius-inputs)] px-4 py-2 text-[length:var(--text-body)] min-h-0",
      },
    },
    defaultVariants: {
      variant: "primary",
    },
  },
);

type BaseProps = VariantProps<typeof buttonVariants> & {
  className?: string;
  children?: React.ReactNode;
};

type ButtonAsButton = BaseProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
    href?: undefined;
  };

type ButtonAsAnchor = BaseProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "className"> & {
    href: string;
  };

export type ButtonProps = ButtonAsButton | ButtonAsAnchor;

export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(
  ({ className, variant, ...props }, ref) => {
    const classes = cn(buttonVariants({ variant }), className);

    if (props.href !== undefined) {
      const { href, ...anchorProps } = props as ButtonAsAnchor;
      return (
        <a
          ref={ref as React.Ref<HTMLAnchorElement>}
          href={href}
          className={classes}
          {...anchorProps}
        />
      );
    }

    const buttonProps = props as ButtonAsButton;
    return (
      <button ref={ref as React.Ref<HTMLButtonElement>} className={classes} {...buttonProps} />
    );
  },
);

Button.displayName = "Button";
