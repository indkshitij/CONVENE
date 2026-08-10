"use client";

import { FieldError, Input, Label } from "@convene/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Industry, ProfileResponse } from "@/lib/api/client";
import { WizardNav } from "@/components/onboarding/wizard-nav";

// PRD §10.1.3 step 3: "industry, years of experience, top 5 skills,
// education (or LinkedIn import)... skills/education skippable." Two
// scope cuts, both flagged rather than fabricated:
//   - Education is omitted entirely — it's explicitly skippable per the
//     PRD table, and a full add/edit education UI would blow the 90s
//     time budget the prompt names for this step.
//   - LinkedIn import is omitted — apps/api has a LinkedIn *OAuth*
//     provider (sign-in only) but no distinct "import my LinkedIn
//     profile data" endpoint anywhere (grepped the whole service layer).
//     BR-AUTH-12's "opt-in per field, review and confirm every imported
//     value, never silent acceptance" has nothing to call yet — building
//     a button with nowhere to POST would be worse than one fewer option
//     (same reasoning P20.1 used to drop the Apple OAuth button).
const UI_SKILLS_CAP = 5; // "top 5 skills" — a UI framing choice; the underlying schema allows up to 30.

export function ProfessionalDepthForm({
  profile,
  etag,
  industries,
}: {
  profile: ProfileResponse;
  etag: string | null;
  industries: Industry[];
}) {
  const router = useRouter();
  const [industryId, setIndustryId] = useState<string>(
    profile.industry?.id ? String(profile.industry.id) : "",
  );
  const [yearsExperience, setYearsExperience] = useState<string>(profile.years_experience ?? "");
  const [skills, setSkills] = useState<string[]>([]);
  const [skillDraft, setSkillDraft] = useState("");
  const [errors, setErrors] = useState<{ industry?: string; years?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function addSkill() {
    const value = skillDraft.trim();
    if (!value) return;
    if (skills.some((skill) => skill.toLowerCase() === value.toLowerCase())) {
      setSkillDraft("");
      return;
    }
    if (skills.length >= UI_SKILLS_CAP) return;
    setSkills((current) => [...current, value]);
    setSkillDraft("");
  }

  function removeSkill(skill: string) {
    setSkills((current) => current.filter((existing) => existing !== skill));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    const nextErrors: typeof errors = {};
    if (!industryId) nextErrors.industry = "Choose your industry.";
    const years = Number(yearsExperience);
    if (yearsExperience !== "" && (Number.isNaN(years) || years < 0 || years > 60))
      nextErrors.years = "Enter a number between 0 and 60.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setIsSubmitting(true);
    try {
      const profileResponse = await fetch("/api/profile/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(etag ? { "If-Match": etag } : {}) },
        body: JSON.stringify({
          industry_id: Number(industryId),
          ...(yearsExperience !== "" ? { years_experience: years } : {}),
        }),
      });
      if (!profileResponse.ok) {
        const body = (await profileResponse.json()) as { error: { message: string } };
        setServerError(body.error.message || "Something went wrong. Please try again.");
        return;
      }

      // Skills are skippable — only call the (full-replace) skills
      // endpoint if the user actually added any.
      if (skills.length > 0) {
        const skillsResponse = await fetch("/api/profile/me/skills", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skills: skills.map((name) => ({ name })) }),
        });
        if (!skillsResponse.ok) {
          const body = (await skillsResponse.json()) as { error: { message: string } };
          setServerError(body.error.message || "Something went wrong. Please try again.");
          return;
        }
      }

      // §10.1.3: "Each step commits before advancing."
      router.push("/setup/4");
    } catch {
      setServerError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      className="flex flex-col gap-[var(--spacing-24)]"
      noValidate
    >
      <div>
        <Label htmlFor="industry">Industry</Label>
        <select
          id="industry"
          value={industryId}
          onChange={(event) => setIndustryId(event.target.value)}
          aria-invalid={!!errors.industry}
          aria-describedby={errors.industry ? "industry-error" : undefined}
          className="min-h-11 w-full rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body)] text-[color:var(--color-ink)]"
        >
          <option value="">Select an industry</option>
          {industries.map((industry) => (
            <option key={industry.id} value={industry.id}>
              {industry.name}
            </option>
          ))}
        </select>
        <FieldError id="industry-error">{errors.industry}</FieldError>
      </div>

      <div>
        <Label htmlFor="years_experience">Years of experience</Label>
        <Input
          id="years_experience"
          type="number"
          min={0}
          max={60}
          inputMode="numeric"
          value={yearsExperience}
          onChange={(event) => setYearsExperience(event.target.value)}
          invalid={!!errors.years}
          aria-describedby={errors.years ? "years-error" : undefined}
        />
        <FieldError id="years-error">{errors.years}</FieldError>
      </div>

      <div>
        <Label htmlFor="skill-draft">Top skills (optional)</Label>
        <div className="flex gap-[var(--spacing-8)]">
          <Input
            id="skill-draft"
            value={skillDraft}
            disabled={skills.length >= UI_SKILLS_CAP}
            onChange={(event) => setSkillDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addSkill();
              }
            }}
          />
          <button
            type="button"
            onClick={addSkill}
            disabled={skills.length >= UI_SKILLS_CAP}
            className="min-h-11 shrink-0 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)] disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {skills.length > 0 && (
          <ul className="mt-[var(--spacing-16)] flex flex-wrap gap-[var(--spacing-8)]">
            {skills.map((skill) => (
              <li
                key={skill}
                className="flex items-center gap-[var(--spacing-8)] rounded-[var(--radius-tags)] bg-[color:var(--color-mist-gray)] px-3 py-1 text-[length:var(--text-body-sm)]"
              >
                {skill}
                <button
                  type="button"
                  onClick={() => removeSkill(skill)}
                  aria-label={`Remove ${skill}`}
                  className="min-h-4 min-w-4"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {serverError && <FieldError>{serverError}</FieldError>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="min-h-11 w-full rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-8 py-3 text-[length:var(--text-body)] text-[color:var(--color-paper-white)] disabled:opacity-50"
      >
        {isSubmitting ? "Saving…" : "Continue"}
      </button>

      <WizardNav backHref="/setup/2" />
    </form>
  );
}
