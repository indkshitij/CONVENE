"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { auth as authValidation } from "@convene/validation";
import { FieldError, Input, Label, PasswordInput } from "@convene/ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { useOnlineStatus } from "@/lib/realtime/use-online-status";
import { SuspendedAccountScreen } from "./suspended-account-screen";

type FormValues = z.infer<typeof authValidation.loginSchema>;

const SUBMIT_TIMEOUT_MS = 10_000; // design.md §14.3: "Button -> spinner, fields disabled, 10s timeout then error."

function isEmailLike(value: string): boolean {
  return value.includes("@");
}

// design.md §14.3. React Hook Form + `packages/validation`'s own
// loginSchema as the resolver (no client-side re-validation of
// email/phone/password shape) — the single visible "email or phone"
// input is a UI-only routing decision (which of the schema's two
// optional fields gets the value), not a second copy of the schema.
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isOnline = useOnlineStatus();
  const [identifier, setIdentifier] = useState("");
  const [serverError, setServerError] = useState<string | null>(
    searchParams.get("oauth_error") ? "That sign-in method didn't work. Please try again." : null,
  );
  const [lockoutSeconds, setLockoutSeconds] = useState<number | null>(null);
  const [suspension, setSuspension] = useState<{ reason: string | null } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(authValidation.loginSchema),
    defaultValues: { password: "" },
  });

  useEffect(() => {
    if (lockoutSeconds === null || lockoutSeconds <= 0) return;
    const timer = setTimeout(
      () => setLockoutSeconds((seconds) => (seconds !== null ? seconds - 1 : null)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [lockoutSeconds]);

  function handleIdentifierChange(value: string) {
    setIdentifier(value);
    if (isEmailLike(value)) {
      setValue("email", value, { shouldValidate: false });
      setValue("phone", undefined, { shouldValidate: false });
    } else {
      setValue("phone", value, { shouldValidate: false });
      setValue("email", undefined, { shouldValidate: false });
    }
  }

  async function onSubmit(values: FormValues) {
    setServerError(null);
    setLockoutSeconds(null);

    const controller = new AbortController();
    timeoutRef.current = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) {
        const envelope = body as {
          error: { code: string; message: string; retry_after: number | null };
        };
        if (response.status === 423) {
          setLockoutSeconds(envelope.error.retry_after ?? 0);
          return;
        }
        if (response.status === 403 && envelope.error.code === "ACCOUNT_SUSPENDED") {
          setSuspension({ reason: envelope.error.message });
          return;
        }
        // design.md §14.3: "401 -> 'Email or password is incorrect'
        // (never which)." Generic, enumeration-safe — the same copy
        // regardless of whether the identifier or the password was wrong.
        setServerError(
          response.status === 401
            ? "Email or password is incorrect."
            : "Something went wrong. Please try again.",
        );
        return;
      }

      const destination = searchParams.get("redirect") ?? "/home";
      router.push(destination);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setServerError("That took too long. Please try again.");
      } else {
        setServerError("Something went wrong. Please try again.");
      }
    } finally {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }
  }

  if (suspension) return <SuspendedAccountScreen reason={suspension.reason} />;

  return (
    <form
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      className="flex flex-col gap-[var(--spacing-24)]"
      noValidate
    >
      <div>
        <Label htmlFor="identifier">Email or phone</Label>
        <Input
          id="identifier"
          name="identifier"
          autoComplete="username"
          value={identifier}
          disabled={isSubmitting || !isOnline}
          invalid={!!(errors.email || errors.phone)}
          aria-describedby={errors.email || errors.phone ? "identifier-error" : undefined}
          onChange={(event) => handleIdentifierChange(event.target.value)}
        />
        <FieldError id="identifier-error">
          {errors.email?.message ?? errors.phone?.message}
        </FieldError>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/password/forgot"
            className="text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)] underline"
          >
            Forgot password?
          </Link>
        </div>
        <PasswordInput
          id="password"
          autoComplete="current-password"
          disabled={isSubmitting || !isOnline}
          invalid={!!errors.password}
          aria-describedby={errors.password ? "password-error" : undefined}
          {...register("password")}
        />
        <FieldError id="password-error">{errors.password?.message}</FieldError>
      </div>

      {lockoutSeconds !== null && lockoutSeconds > 0 && (
        <FieldError>{`Too many attempts — try again in ${Math.floor(lockoutSeconds / 60)}:${String(lockoutSeconds % 60).padStart(2, "0")}`}</FieldError>
      )}
      {serverError && <FieldError>{serverError}</FieldError>}
      {!isOnline && (
        <p
          role="status"
          className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]"
        >
          You&apos;re offline — check your connection to log in.
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting || !isOnline || (lockoutSeconds !== null && lockoutSeconds > 0)}
        className="min-h-11 w-full rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-8 py-3 text-[length:var(--text-body)] text-[color:var(--color-paper-white)] disabled:opacity-50"
      >
        {isSubmitting ? "Logging in…" : "Log in"}
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
