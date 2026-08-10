"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { auth as authValidation } from "@convene/validation";
import { FieldError, Input, Label, PasswordInput } from "@convene/ui";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { CURRENT_TERMS_VERSION } from "@/lib/auth/terms-version";
import { useOnlineStatus } from "@/lib/realtime/use-online-status";
import { AgeGateScreen } from "./age-gate-screen";
import { PasswordStrength } from "./password-strength";

type FormValues = z.infer<typeof authValidation.registerSchema>;

// A plausible adult birth year (25 years ago) as the date input's
// default view — design.md §14.4: "defaults to a plausible adult year
// to avoid scroll fatigue." A native `<input type="date">` is used
// rather than three separate selects; it satisfies the same "avoid
// scroll fatigue" goal (most browsers render a compact date picker) with
// far less form-state code, and still binds directly to
// dobAdultSchema's expected date-parseable string.
function defaultAdultDate(): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 25);
  return date.toISOString().slice(0, 10);
}

export function SignupForm() {
  const isOnline = useOnlineStatus();
  const [method, setMethod] = useState<"email" | "phone">("email");
  const [serverError, setServerError] = useState<string | null>(null);
  const [duplicateAccount, setDuplicateAccount] = useState(false);
  const [ageGated, setAgeGated] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(authValidation.registerSchema),
    // design.md §14.4: "validation on blur, not on keypress (except the
    // password meter)" — the strength meter itself is driven by `watch`,
    // not by RHF's own validation mode, so this doesn't affect it.
    mode: "onBlur",
    defaultValues: {
      method: "email",
      date_of_birth: defaultAdultDate(),
      accepted_terms_version: CURRENT_TERMS_VERSION,
    },
  });

  const password = watch("password") ?? "";

  function handleMethodChange(next: "email" | "phone") {
    setMethod(next);
    setValue("method", next, { shouldValidate: false });
    setValue("email", undefined, { shouldValidate: false });
    setValue("phone", undefined, { shouldValidate: false });
  }

  async function onSubmit(values: FormValues) {
    setServerError(null);
    setDuplicateAccount(false);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error: { code: string; message: string } };
        if (response.status === 409 && body.error.code === "EMAIL_ALREADY_EXISTS") {
          // §13.2: "Email exists, verified -> Offer login / password
          // reset" — the one case the PRD itself sanctions disclosing
          // (see this component's own note in the file header history).
          setDuplicateAccount(true);
          return;
        }
        if (response.status === 403 && body.error.code === "AGE_RESTRICTED") {
          setAgeGated(true);
          return;
        }
        setServerError(body.error.message || "Something went wrong. Please try again.");
        return;
      }

      // §13.2: an unverified-duplicate email is silently handled as an
      // ordinary 201 by apps/api (resendUnverifiedRegistration) — this
      // branch can't and shouldn't distinguish that from a brand-new
      // signup, which is exactly what "no enumeration leak" requires.
      setCheckEmail(true);
    } catch {
      setServerError("Something went wrong. Please try again.");
    }
  }

  if (ageGated) return <AgeGateScreen />;

  if (checkEmail) {
    return (
      <div className="flex flex-col gap-[var(--spacing-16)] text-center">
        <h1 className="text-[length:var(--text-heading-sm)] font-[family-name:var(--font-aeonik)] text-[color:var(--color-ink)]">
          Check your email
        </h1>
        <p className="text-[length:var(--text-body)] text-[color:var(--color-graphite)]">
          We sent a verification link. Click it to finish setting up your account.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      className="flex flex-col gap-[var(--spacing-24)]"
      noValidate
    >
      <div>
        <Label htmlFor="full_name">Full name</Label>
        <Input
          id="full_name"
          autoComplete="name"
          invalid={!!errors.full_name}
          aria-describedby={errors.full_name ? "full_name-error" : undefined}
          {...register("full_name")}
        />
        <FieldError id="full_name-error">{errors.full_name?.message}</FieldError>
      </div>

      <fieldset
        className="flex gap-[var(--spacing-16)]"
        role="radiogroup"
        aria-label="Sign up with"
      >
        <label className="flex min-h-11 items-center gap-[var(--spacing-8)] text-[length:var(--text-body-sm)]">
          <input
            type="radio"
            name="method-toggle"
            checked={method === "email"}
            onChange={() => handleMethodChange("email")}
          />{" "}
          Email
        </label>
        <label className="flex min-h-11 items-center gap-[var(--spacing-8)] text-[length:var(--text-body-sm)]">
          <input
            type="radio"
            name="method-toggle"
            checked={method === "phone"}
            onChange={() => handleMethodChange("phone")}
          />{" "}
          Phone
        </label>
      </fieldset>

      {method === "email" ? (
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            invalid={!!errors.email}
            aria-describedby={errors.email ? "email-error" : undefined}
            {...register("email")}
          />
          <FieldError id="email-error">{errors.email?.message}</FieldError>
          {duplicateAccount && (
            <p
              role="alert"
              className="mt-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]"
            >
              You already have an account —{" "}
              <Link href="/login" className="underline">
                log in?
              </Link>
            </p>
          )}
        </div>
      ) : (
        <div>
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            type="tel"
            autoComplete="tel"
            invalid={!!errors.phone}
            aria-describedby={errors.phone ? "phone-error" : undefined}
            {...register("phone")}
          />
          <FieldError id="phone-error">{errors.phone?.message}</FieldError>
        </div>
      )}

      <div>
        <Label htmlFor="password">Password</Label>
        <PasswordInput
          id="password"
          autoComplete="new-password"
          invalid={!!errors.password}
          aria-describedby={errors.password ? "password-error" : undefined}
          {...register("password")}
        />
        <FieldError id="password-error">{errors.password?.message}</FieldError>
        <PasswordStrength value={password} />
      </div>

      <div>
        <Label htmlFor="date_of_birth">Date of birth</Label>
        <Input
          id="date_of_birth"
          type="date"
          invalid={!!errors.date_of_birth}
          aria-describedby={errors.date_of_birth ? "dob-error" : undefined}
          {...register("date_of_birth")}
        />
        <FieldError id="dob-error">{errors.date_of_birth?.message}</FieldError>
      </div>

      <input type="hidden" {...register("accepted_terms_version")} />

      <label className="flex items-start gap-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
        <input type="checkbox" required className="mt-1 min-h-4 min-w-4" />
        <span>
          I agree to the{" "}
          <Link href="/legal/terms" className="text-[color:var(--color-iris-blue)] underline">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/legal/privacy" className="text-[color:var(--color-iris-blue)] underline">
            Privacy Policy
          </Link>
          .
        </span>
      </label>

      {serverError && <FieldError>{serverError}</FieldError>}
      {!isOnline && (
        <p
          role="status"
          className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]"
        >
          You&apos;re offline — check your connection to sign up.
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting || !isOnline}
        className="min-h-11 w-full rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-8 py-3 text-[length:var(--text-body)] text-[color:var(--color-paper-white)] disabled:opacity-50"
      >
        {isSubmitting ? "Creating account…" : "Create account"}
      </button>

      <div className="flex items-center gap-[var(--spacing-16)]">
        <div className="h-px flex-1 bg-[color:var(--color-mist-gray)]" />
        <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
          or
        </span>
        <div className="h-px flex-1 bg-[color:var(--color-mist-gray)]" />
      </div>

      <OAuthButtons />
    </form>
  );
}
