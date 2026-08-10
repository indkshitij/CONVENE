import { forwardRef } from "react";
import { cn } from "../lib/cn";

// design.md §14.3/§15.10: "44px targets" — min-h-11 (44px) matches
// Button's own min-height so form fields and the submit button read as
// the same tap-target scale. `aria-invalid`/`aria-describedby` are the
// caller's responsibility (RHF's `register()` output plus the field's
// own error id) since only the call site knows which error, if any,
// currently applies.
export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "min-h-11 w-full rounded-[var(--radius-inputs)] border px-[var(--spacing-16)] py-[var(--spacing-8)] font-[family-name:var(--font-geist)] text-[length:var(--text-body)] text-[color:var(--color-ink)] outline-none transition-colors placeholder:text-[color:var(--color-fog)] focus-visible:ring-2 focus-visible:ring-[color:var(--color-iris-blue)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        invalid
          ? "border-[color:var(--color-danger-text)]"
          : "border-[color:var(--color-mist-gray)]",
        className,
      )}
      aria-invalid={invalid ? true : undefined}
      {...props}
    />
  ),
);

Input.displayName = "Input";
