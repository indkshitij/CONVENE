"use client";

import { forwardRef, useState } from "react";
import { cn } from "../lib/cn";
import { Input, type InputProps } from "../input/input";

// design.md §14.3: "password (with reveal toggle)."
export type PasswordInputProps = Omit<InputProps, "type">;

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, ...props }, ref) => {
    const [visible, setVisible] = useState(false);

    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? "text" : "password"}
          className={cn("pr-12", className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex min-h-11 min-w-11 items-center justify-center text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
    );
  },
);

PasswordInput.displayName = "PasswordInput";
