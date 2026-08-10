"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { auth as authValidation } from "@convene/validation";
import { FieldError, Label, PasswordInput } from "@convene/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { AuthCardHeading } from "@/components/shared/auth-card-heading";
import { ApiError } from "@/lib/api/client";

type FormValues = z.infer<typeof authValidation.oauthConfirmLinkSchema>;

export function OAuthLinkForm({ linkToken, provider }: { linkToken: string; provider: string }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(authValidation.oauthConfirmLinkSchema),
    defaultValues: { link_token: linkToken, password: "" },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      const response = await fetch("/api/auth/oauth/confirm-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error: { message: string } };
        throw new ApiError(response.status, {
          error: {
            ...body.error,
            code: "LINK_FAILED",
            field: null,
            details: null,
            request_id: null,
            retry_after: null,
          },
        });
      }
      router.push("/home");
    } catch {
      // Generic, enumeration-safe copy — never confirm/deny which part
      // (link token vs password) was wrong, same reasoning as login's
      // own 401 copy.
      setServerError("That didn't work. Check your password and try again.");
    }
  }

  if (!linkToken) {
    return (
      <AuthCardHeading
        title="Link expired"
        subtitle="This sign-in link is no longer valid. Please try again."
      />
    );
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      className="flex flex-col gap-[var(--spacing-24)]"
      noValidate
    >
      <AuthCardHeading
        title="Confirm it's you"
        subtitle={`An account with this email already exists. Enter your password to link your ${provider} sign-in.`}
      />
      <input type="hidden" {...register("link_token")} />
      <div>
        <Label htmlFor="password">Password</Label>
        <PasswordInput
          id="password"
          autoComplete="current-password"
          invalid={!!errors.password}
          aria-describedby={errors.password ? "password-error" : undefined}
          {...register("password")}
        />
        <FieldError id="password-error">{errors.password?.message}</FieldError>
      </div>
      {serverError && <FieldError>{serverError}</FieldError>}
      <button
        type="submit"
        disabled={isSubmitting}
        className="min-h-11 w-full rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-8 py-3 text-[length:var(--text-body)] text-[color:var(--color-paper-white)] disabled:opacity-50"
      >
        {isSubmitting ? "Linking…" : "Link account"}
      </button>
    </form>
  );
}
