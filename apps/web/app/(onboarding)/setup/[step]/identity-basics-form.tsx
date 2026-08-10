"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { profile as profileValidation } from "@convene/validation";
import { FieldError, Input, Label } from "@convene/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import type { ProfileResponse } from "@/lib/api/client";
import { WizardNav } from "@/components/onboarding/wizard-nav";

// PRD §10.1.3 step 2: "Identity basics: name, photo, headline, current
// role/company." Photo is omitted here — avatar upload is the media
// pipeline (§17.7), a separate feature this phase doesn't build; that's
// consistent with the PRD's own "photo optional" allowance, not a
// silent scope cut of something required. Field count kept to four
// (name/headline/job title/company) plus an optional employment-type
// select, matching the 60s time budget the prompt names.
const stepTwoSchema = profileValidation.profileUpdateSchema.pick({
  full_name: true,
  headline: true,
  job_title: true,
  company_name: true,
  employment_type: true,
});
type FormValues = z.infer<typeof stepTwoSchema>;

const EMPLOYMENT_TYPES = [
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "freelance", label: "Freelance" },
  { value: "self_employed", label: "Self-employed" },
  { value: "student", label: "Student" },
  { value: "unemployed", label: "Between roles" },
  { value: "founder", label: "Founder" },
] as const;

export function IdentityBasicsForm({
  profile,
  etag,
  fullName,
}: {
  profile: ProfileResponse;
  etag: string | null;
  fullName: string;
}) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(stepTwoSchema),
    defaultValues: {
      full_name: fullName,
      headline: profile.headline ?? "",
      job_title: profile.job_title ?? "",
      company_name: profile.company?.name ?? "",
    },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      const response = await fetch("/api/profile/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(etag ? { "If-Match": etag } : {}) },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error: { message: string } };
        setServerError(body.error.message || "Something went wrong. Please try again.");
        return;
      }
      // §10.1.3: "Each step commits before advancing" — the PATCH above
      // is that commit; only navigate once it has actually succeeded.
      router.push("/setup/3");
    } catch {
      setServerError("Something went wrong. Please try again.");
    }
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

      <div>
        <Label htmlFor="headline">Headline</Label>
        <Input
          id="headline"
          placeholder="e.g. Product engineer building developer tools"
          invalid={!!errors.headline}
          aria-describedby={errors.headline ? "headline-error" : undefined}
          {...register("headline")}
        />
        <FieldError id="headline-error">{errors.headline?.message}</FieldError>
      </div>

      <div>
        <Label htmlFor="job_title">Current role</Label>
        <Input
          id="job_title"
          invalid={!!errors.job_title}
          aria-describedby={errors.job_title ? "job_title-error" : undefined}
          {...register("job_title")}
        />
        <FieldError id="job_title-error">{errors.job_title?.message}</FieldError>
      </div>

      <div>
        <Label htmlFor="company_name">Company</Label>
        <Input
          id="company_name"
          invalid={!!errors.company_name}
          aria-describedby={errors.company_name ? "company_name-error" : undefined}
          {...register("company_name")}
        />
        <FieldError id="company_name-error">{errors.company_name?.message}</FieldError>
      </div>

      <div>
        <Label htmlFor="employment_type">Work status</Label>
        <select
          id="employment_type"
          className="min-h-11 w-full rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body)] text-[color:var(--color-ink)]"
          {...register("employment_type")}
        >
          <option value="">Prefer not to say</option>
          {EMPLOYMENT_TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {serverError && <FieldError>{serverError}</FieldError>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="min-h-11 w-full rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-8 py-3 text-[length:var(--text-body)] text-[color:var(--color-paper-white)] disabled:opacity-50"
      >
        {isSubmitting ? "Saving…" : "Continue"}
      </button>

      <WizardNav backHref={null} />
    </form>
  );
}
