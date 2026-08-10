"use client";

import { useRef } from "react";
import { cn } from "@convene/ui";

const DIGIT_COUNT = 6;

export interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  hasError?: boolean;
  autoFocus?: boolean;
}

// design.md §14.5: "6 single-digit boxes (auto-advance, paste-aware, SMS
// autofill via autocomplete="one-time-code")." `value`/`onChange` is a
// single controlled 6-char string (digits only) — the parent form owns
// it via RHF's `Controller`, same as any other field; this component's
// only job is turning 6 boxes' worth of key/paste events into that one
// string.
export function OtpInput({ value, onChange, disabled, hasError, autoFocus }: OtpInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: DIGIT_COUNT }, (_, i) => value[i] ?? "");

  function setDigit(index: number, digit: string) {
    const next = digits.slice();
    next[index] = digit;
    onChange(next.join(""));
  }

  function handleChange(index: number, raw: string) {
    // A paste into a single box can land its whole string here too
    // (mobile Safari does this) — reuse the same paste handling either way.
    const cleaned = raw.replace(/\D/g, "");
    if (cleaned.length > 1) {
      applyPaste(index, cleaned);
      return;
    }
    setDigit(index, cleaned);
    if (cleaned && index < DIGIT_COUNT - 1) inputRefs.current[index + 1]?.focus();
  }

  function applyPaste(startIndex: number, digitsString: string) {
    const next = digits.slice();
    let cursor = startIndex;
    for (const char of digitsString) {
      if (cursor >= DIGIT_COUNT) break;
      next[cursor] = char;
      cursor += 1;
    }
    onChange(next.join(""));
    inputRefs.current[Math.min(cursor, DIGIT_COUNT - 1)]?.focus();
  }

  function handlePaste(index: number, event: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "");
    if (!pasted) return;
    event.preventDefault();
    applyPaste(index, pasted);
  }

  function handleKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
      setDigit(index - 1, "");
    } else if (event.key === "ArrowLeft" && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (event.key === "ArrowRight" && index < DIGIT_COUNT - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  return (
    <div
      className={cn("flex gap-[var(--spacing-8)]", hasError && "otp-shake")}
      role="group"
      aria-label="Verification code"
    >
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            inputRefs.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="\d*"
          maxLength={1}
          value={digit}
          disabled={disabled}
          autoFocus={autoFocus && index === 0}
          autoComplete="one-time-code"
          aria-label={`Digit ${index + 1} of ${DIGIT_COUNT}`}
          aria-invalid={hasError ? true : undefined}
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={(event) => handlePaste(index, event)}
          onFocus={(event) => event.target.select()}
          className={cn(
            "h-14 w-11 rounded-[var(--radius-inputs)] border text-center font-[family-name:var(--font-geist)] text-[length:var(--text-heading-sm)] text-[color:var(--color-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-iris-blue)] focus-visible:ring-offset-2",
            hasError
              ? "border-[color:var(--color-danger-text)]"
              : "border-[color:var(--color-mist-gray)]",
          )}
        />
      ))}
    </div>
  );
}
