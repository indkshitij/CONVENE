"use client";

import { useState } from "react";
import type {
  CertificationEntry,
  CompletionResult,
  EducationEntry,
  ExperienceEntry,
  FullProfileResponse,
  Industry,
  PortfolioEntry,
} from "@/lib/api/client";
import { pushToast } from "@/stores/ui";

type FieldPatch = Record<string, unknown>;

async function patchProfile(
  etag: string | null,
  patch: FieldPatch,
): Promise<
  | { ok: true; data: FullProfileResponse; etag: string | null }
  | { ok: false; conflict: true }
  | { ok: false; conflict: false; message: string }
> {
  const response = await fetch("/api/profile/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "If-Match": etag ?? "" },
    body: JSON.stringify(patch),
  });
  if (response.status === 409) return { ok: false, conflict: true };
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    return {
      ok: false,
      conflict: false,
      message: body?.error?.message ?? "Couldn't save. Please try again.",
    };
  }
  const data = (await response.json()) as FullProfileResponse;
  return { ok: true, data, etag: response.headers.get("ETag") };
}

export function EditProfileScreen({
  initialProfile,
  initialEtag,
  initialCompletion,
  industries,
}: {
  initialProfile: FullProfileResponse;
  initialEtag: string | null;
  initialCompletion: CompletionResult;
  industries: Industry[];
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [etag, setEtag] = useState(initialEtag);
  const [completion, setCompletion] = useState(initialCompletion);
  const [fullName, setFullName] = useState(profile.full_name);
  const [headline, setHeadline] = useState(profile.headline ?? "");
  const [about, setAbout] = useState(profile.about ?? "");
  const [jobTitle, setJobTitle] = useState(profile.job_title ?? "");
  const [companyName, setCompanyName] = useState(profile.company?.name ?? "");
  const [industryId, setIndustryId] = useState<number | "">(profile.industry?.id ?? "");
  const [yearsExperience, setYearsExperience] = useState(profile.years_experience);

  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pendingPatch, setPendingPatch] = useState<FieldPatch | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function refreshCompletion() {
    const response = await fetch("/api/profile/me/completion");
    if (response.ok) setCompletion((await response.json()) as CompletionResult);
  }

  async function save(patch: FieldPatch) {
    if (conflict) return;
    setFieldError(null);
    const result = await patchProfile(etag, patch);
    if (result.ok) {
      setProfile(result.data);
      setEtag(result.etag);
      const savedTimestamp = Date.now();
      setSavedAt(savedTimestamp);
      setTimeout(
        () => setSavedAt((current) => (current === savedTimestamp ? null : current)),
        3000,
      );
      void refreshCompletion();
      return;
    }
    if (result.conflict) {
      setPendingPatch(patch);
      setConflict(true);
      return;
    }
    setFieldError(result.message);
  }

  async function reloadFromServer() {
    window.location.reload();
  }

  async function keepMyChange() {
    if (!pendingPatch) return;
    const fresh = await fetch("/api/profile/me");
    const freshEtag = fresh.headers.get("ETag");
    const result = await patchProfile(freshEtag, pendingPatch);
    if (result.ok) {
      setProfile(result.data);
      setEtag(result.etag);
      setConflict(false);
      setPendingPatch(null);
      setSavedAt(Date.now());
      void refreshCompletion();
    } else if (!result.conflict) {
      setFieldError(result.message);
    }
  }

  async function saveSkills(next: FullProfileResponse["skills"]) {
    const response = await fetch("/api/profile/me/skills", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skills: next }),
    });
    if (response.ok) {
      setProfile((current) => ({ ...current, skills: next }));
      void refreshCompletion();
    } else {
      pushToast({ variant: "error", message: "Couldn't update skills. Please try again." });
    }
  }

  async function saveInterests(next: string[]) {
    const response = await fetch("/api/profile/me/interests", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (response.ok) setProfile((current) => ({ ...current, interests: next }));
    else pushToast({ variant: "error", message: "Couldn't update interests. Please try again." });
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-[var(--spacing-24)] px-[var(--spacing-24)] py-[var(--spacing-24)]">
      <div className="flex items-center justify-between">
        <h1 className="text-[length:var(--text-heading-sm)] font-[family-name:var(--font-aeonik)] text-[color:var(--color-ink)]">
          Edit profile
        </h1>
        {savedAt && !conflict && (
          <span
            role="status"
            className="text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)]"
          >
            Saved ✓
          </span>
        )}
      </div>

      {conflict && (
        <div
          role="alert"
          className="rounded-[var(--radius-cards)] p-[var(--spacing-16)]"
          style={{ backgroundColor: "var(--color-warning-tint)" }}
        >
          <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
            This profile changed elsewhere — reload to see the current version.
          </p>
          <div className="mt-[var(--spacing-8)] flex gap-[var(--spacing-8)]">
            <button
              type="button"
              onClick={() => void reloadFromServer()}
              className="min-h-11 rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)]"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={() => void keepMyChange()}
              className="min-h-11 rounded-[var(--radius-buttons)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
            >
              Keep my change
            </button>
          </div>
        </div>
      )}

      {fieldError && (
        <p
          role="alert"
          className="text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]"
        >
          {fieldError}
        </p>
      )}

      <div className="rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]">
        <p className="numeric text-[length:var(--text-body-sm)] font-semibold text-[color:var(--color-ink)]">
          {completion.score}% complete
        </p>
        {completion.missing[0] && (
          <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
            Next: {completion.missing[0].cta} (+{completion.missing[0].impact}%)
          </p>
        )}
      </div>

      <section className="flex flex-col gap-[var(--spacing-16)]">
        <label className="flex flex-col gap-1">
          <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
            Full name
          </span>
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            onBlur={() => fullName !== profile.full_name && void save({ full_name: fullName })}
            className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body)] text-[color:var(--color-ink)]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
            Headline
          </span>
          <input
            value={headline}
            maxLength={120}
            onChange={(event) => setHeadline(event.target.value)}
            onBlur={() =>
              headline !== (profile.headline ?? "") &&
              headline.length >= 10 &&
              void save({ headline })
            }
            className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body)] text-[color:var(--color-ink)]"
          />
          <span className="numeric self-end text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
            {headline.length}/120
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
            About
          </span>
          <textarea
            value={about}
            maxLength={2000}
            rows={4}
            onChange={(event) => setAbout(event.target.value)}
            onBlur={() => about !== (profile.about ?? "") && void save({ about: about || null })}
            className="rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body)] text-[color:var(--color-ink)]"
          />
          <span className="numeric self-end text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
            {about.length}/2000
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
            Job title
          </span>
          <input
            value={jobTitle}
            onChange={(event) => setJobTitle(event.target.value)}
            onBlur={() =>
              jobTitle !== (profile.job_title ?? "") &&
              jobTitle.length >= 2 &&
              void save({ job_title: jobTitle })
            }
            className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body)] text-[color:var(--color-ink)]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
            Company
          </span>
          <input
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            onBlur={() =>
              companyName !== (profile.company?.name ?? "") &&
              void save({ company_name: companyName || null })
            }
            className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body)] text-[color:var(--color-ink)]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
            Industry
          </span>
          <select
            value={industryId}
            onChange={(event) => {
              const next = event.target.value ? Number(event.target.value) : "";
              setIndustryId(next);
              if (next !== "" && next !== profile.industry?.id) void save({ industry_id: next });
            }}
            className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body)] text-[color:var(--color-ink)]"
          >
            <option value="">Select an industry</option>
            {industries.map((industry) => (
              <option key={industry.id} value={industry.id}>
                {industry.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
            Years of experience
          </span>
          <input
            type="number"
            min={0}
            max={60}
            value={yearsExperience}
            onChange={(event) => setYearsExperience(event.target.value)}
            onBlur={() =>
              yearsExperience !== profile.years_experience &&
              void save({ years_experience: Number(yearsExperience) })
            }
            className="min-h-11 w-32 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body)] text-[color:var(--color-ink)]"
          />
        </label>
      </section>

      <ChipListEditor
        title="Skills"
        inputLabel="Add a skill"
        values={profile.skills.map((skill) => skill.name)}
        max={30}
        onSave={(names) =>
          void saveSkills(names.map((name) => ({ name, proficiency: null, years: null })))
        }
      />

      <ChipListEditor
        title="Interests"
        inputLabel="Add an interest"
        values={profile.interests}
        max={15}
        onSave={(next) => void saveInterests(next)}
      />

      <ExperienceSection
        items={profile.experience}
        onChanged={(items) => setProfile((current) => ({ ...current, experience: items }))}
        onRefreshCompletion={refreshCompletion}
      />
      <EducationSection
        items={profile.education}
        onChanged={(items) => setProfile((current) => ({ ...current, education: items }))}
        onRefreshCompletion={refreshCompletion}
      />
      <CertificationsSection
        items={profile.certifications}
        onChanged={(items) => setProfile((current) => ({ ...current, certifications: items }))}
      />
      <PortfolioSection
        items={profile.portfolio}
        onChanged={(items) => setProfile((current) => ({ ...current, portfolio: items }))}
      />
    </div>
  );
}

function ChipListEditor({
  title,
  inputLabel,
  values,
  max,
  onSave,
}: {
  title: string;
  inputLabel: string;
  values: string[];
  max: number;
  onSave: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const value = draft.trim();
    if (!value || values.includes(value) || values.length >= max) return;
    onSave([...values, value]);
    setDraft("");
  }

  function remove(value: string) {
    onSave(values.filter((existing) => existing !== value));
  }

  return (
    <section className="flex flex-col gap-[var(--spacing-8)] border-t border-[color:var(--color-mist-gray)] pt-[var(--spacing-16)]">
      <h2 className="text-[length:var(--text-caption)] font-medium uppercase tracking-wide text-[color:var(--color-graphite)]">
        {title} ({values.length}/{max})
      </h2>
      <div className="flex flex-wrap gap-[var(--spacing-8)]">
        {values.map((value) => (
          <span
            key={value}
            className="flex items-center gap-1 rounded-[var(--radius-tags)] bg-[color:var(--color-mist-gray)] px-3 py-1 text-[length:var(--text-caption)] text-[color:var(--color-ink)]"
          >
            {value}
            <button
              type="button"
              onClick={() => remove(value)}
              aria-label={`Remove ${value}`}
              className="min-h-4 min-w-4"
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-[var(--spacing-8)]">
        <input
          aria-label={inputLabel}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          className="min-h-11 flex-1 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
        />
        <button
          type="button"
          onClick={add}
          className="min-h-11 rounded-[var(--radius-buttons)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
        >
          + Add
        </button>
      </div>
    </section>
  );
}

function ExperienceSection({
  items,
  onChanged,
  onRefreshCompletion,
}: {
  items: ExperienceEntry[];
  onChanged: (items: ExperienceEntry[]) => void;
  onRefreshCompletion: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function startAdd() {
    setForm({
      company_name: "",
      title: "",
      employment_type: "",
      location_text: "",
      description: "",
      start_date: "",
      end_date: "",
      is_current: false,
    });
    setOpen("new");
    setError(null);
  }

  function startEdit(entry: ExperienceEntry) {
    setForm({
      company_name: entry.company_name,
      title: entry.title,
      employment_type: entry.employment_type ?? "",
      location_text: entry.location_text ?? "",
      description: entry.description ?? "",
      start_date: entry.start_date.slice(0, 10),
      end_date: entry.end_date?.slice(0, 10) ?? "",
      is_current: entry.is_current,
    });
    setOpen(entry.id);
    setError(null);
  }

  async function submit() {
    const body = {
      company_name: form.company_name,
      title: form.title,
      employment_type: form.employment_type || undefined,
      location_text: form.location_text || undefined,
      description: form.description || undefined,
      start_date: form.start_date,
      end_date: form.is_current ? null : form.end_date || null,
      is_current: Boolean(form.is_current),
    };
    const isNew = open === "new";
    const response = await fetch(
      isNew ? "/api/profile/me/experience" : `/api/profile/me/experience/${open}`,
      {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(errorBody?.error?.message ?? "Couldn't save this entry.");
      return;
    }
    const saved = (await response.json()) as ExperienceEntry;
    onChanged(
      isNew ? [...items, saved] : items.map((entry) => (entry.id === saved.id ? saved : entry)),
    );
    void onRefreshCompletion();
    setOpen(null);
  }

  async function remove(id: string) {
    const response = await fetch(`/api/profile/me/experience/${id}`, { method: "DELETE" });
    if (response.ok) {
      onChanged(items.filter((entry) => entry.id !== id));
      void onRefreshCompletion();
    }
    setConfirmDeleteId(null);
  }

  return (
    <section className="flex flex-col gap-[var(--spacing-8)] border-t border-[color:var(--color-mist-gray)] pt-[var(--spacing-16)]">
      <div className="flex items-center justify-between">
        <h2 className="text-[length:var(--text-caption)] font-medium uppercase tracking-wide text-[color:var(--color-graphite)]">
          Experience
        </h2>
        <button
          type="button"
          onClick={startAdd}
          className="min-h-11 text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)]"
        >
          + Add
        </button>
      </div>

      {items.length === 0 && open !== "new" && (
        <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
          No experience added yet.
        </p>
      )}

      <ul className="flex flex-col gap-[var(--spacing-8)]">
        {items.map((entry) => (
          <li
            key={entry.id}
            className="flex items-start justify-between gap-[var(--spacing-8)] rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]"
          >
            <div>
              <p className="text-[length:var(--text-body-sm)] font-medium text-[color:var(--color-ink)]">
                {entry.title}
              </p>
              <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                {entry.company_name}
              </p>
            </div>
            {confirmDeleteId === entry.id ? (
              <div className="flex shrink-0 items-center gap-[var(--spacing-8)]">
                <span className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                  Delete?
                </span>
                <button
                  type="button"
                  onClick={() => void remove(entry.id)}
                  className="min-h-11 text-[length:var(--text-caption)] text-[color:var(--color-danger-text)]"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  className="min-h-11 text-[length:var(--text-caption)] text-[color:var(--color-graphite)]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex shrink-0 gap-[var(--spacing-8)]">
                <button
                  type="button"
                  onClick={() => startEdit(entry)}
                  aria-label="Edit"
                  className="min-h-11 min-w-11"
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(entry.id)}
                  aria-label="Delete"
                  className="min-h-11 min-w-11"
                >
                  🗑
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {open && (
        <div className="flex flex-col gap-[var(--spacing-8)] rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]">
          {error && (
            <p
              role="alert"
              className="text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]"
            >
              {error}
            </p>
          )}
          <input
            placeholder="Title"
            value={String(form.title ?? "")}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)]"
          />
          <input
            placeholder="Company"
            value={String(form.company_name ?? "")}
            onChange={(event) =>
              setForm((current) => ({ ...current, company_name: event.target.value }))
            }
            className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)]"
          />
          <div className="flex gap-[var(--spacing-8)]">
            <input
              aria-label="Start date"
              type="date"
              value={String(form.start_date ?? "")}
              onChange={(event) =>
                setForm((current) => ({ ...current, start_date: event.target.value }))
              }
              className="min-h-11 flex-1 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)]"
            />
            <input
              aria-label="End date"
              type="date"
              disabled={Boolean(form.is_current)}
              value={String(form.end_date ?? "")}
              onChange={(event) =>
                setForm((current) => ({ ...current, end_date: event.target.value }))
              }
              className="min-h-11 flex-1 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)]"
            />
          </div>
          <label className="flex items-center gap-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
            <input
              type="checkbox"
              checked={Boolean(form.is_current)}
              onChange={(event) =>
                setForm((current) => ({ ...current, is_current: event.target.checked }))
              }
            />
            I currently work here
          </label>
          <textarea
            placeholder="Description"
            value={String(form.description ?? "")}
            onChange={(event) =>
              setForm((current) => ({ ...current, description: event.target.value }))
            }
            className="rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)]"
          />
          <div className="flex gap-[var(--spacing-8)]">
            <button
              type="button"
              onClick={() => void submit()}
              className="min-h-11 rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)]"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="min-h-11 rounded-[var(--radius-buttons)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function EducationSection({
  items,
  onChanged,
  onRefreshCompletion,
}: {
  items: EducationEntry[];
  onChanged: (items: EducationEntry[]) => void;
  onRefreshCompletion: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function startAdd() {
    setForm({ school: "", degree: "", field_of_study: "" });
    setOpen("new");
    setError(null);
  }

  function startEdit(entry: EducationEntry) {
    setForm({
      school: entry.school,
      degree: entry.degree ?? "",
      field_of_study: entry.field_of_study ?? "",
    });
    setOpen(entry.id);
    setError(null);
  }

  async function submit() {
    const body = {
      school: form.school,
      degree: form.degree || undefined,
      field_of_study: form.field_of_study || undefined,
    };
    const isNew = open === "new";
    const response = await fetch(
      isNew ? "/api/profile/me/education" : `/api/profile/me/education/${open}`,
      {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(errorBody?.error?.message ?? "Couldn't save this entry.");
      return;
    }
    const saved = (await response.json()) as EducationEntry;
    onChanged(
      isNew ? [...items, saved] : items.map((entry) => (entry.id === saved.id ? saved : entry)),
    );
    void onRefreshCompletion();
    setOpen(null);
  }

  async function remove(id: string) {
    const response = await fetch(`/api/profile/me/education/${id}`, { method: "DELETE" });
    if (response.ok) {
      onChanged(items.filter((entry) => entry.id !== id));
      void onRefreshCompletion();
    }
    setConfirmDeleteId(null);
  }

  return (
    <section className="flex flex-col gap-[var(--spacing-8)] border-t border-[color:var(--color-mist-gray)] pt-[var(--spacing-16)]">
      <div className="flex items-center justify-between">
        <h2 className="text-[length:var(--text-caption)] font-medium uppercase tracking-wide text-[color:var(--color-graphite)]">
          Education
        </h2>
        <button
          type="button"
          onClick={startAdd}
          className="min-h-11 text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)]"
        >
          + Add
        </button>
      </div>

      {items.length === 0 && open !== "new" && (
        <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
          No education added yet.
        </p>
      )}

      <ul className="flex flex-col gap-[var(--spacing-8)]">
        {items.map((entry) => (
          <li
            key={entry.id}
            className="flex items-start justify-between gap-[var(--spacing-8)] rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]"
          >
            <div>
              <p className="text-[length:var(--text-body-sm)] font-medium text-[color:var(--color-ink)]">
                {entry.school}
              </p>
              <p className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                {[entry.degree, entry.field_of_study].filter(Boolean).join(", ")}
              </p>
            </div>
            {confirmDeleteId === entry.id ? (
              <div className="flex shrink-0 items-center gap-[var(--spacing-8)]">
                <span className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                  Delete?
                </span>
                <button
                  type="button"
                  onClick={() => void remove(entry.id)}
                  className="min-h-11 text-[length:var(--text-caption)] text-[color:var(--color-danger-text)]"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  className="min-h-11 text-[length:var(--text-caption)] text-[color:var(--color-graphite)]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex shrink-0 gap-[var(--spacing-8)]">
                <button
                  type="button"
                  onClick={() => startEdit(entry)}
                  aria-label="Edit"
                  className="min-h-11 min-w-11"
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(entry.id)}
                  aria-label="Delete"
                  className="min-h-11 min-w-11"
                >
                  🗑
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {open && (
        <div className="flex flex-col gap-[var(--spacing-8)] rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]">
          {error && (
            <p
              role="alert"
              className="text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]"
            >
              {error}
            </p>
          )}
          <input
            placeholder="School"
            value={form.school ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, school: event.target.value }))}
            className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)]"
          />
          <input
            placeholder="Degree"
            value={form.degree ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, degree: event.target.value }))}
            className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)]"
          />
          <input
            placeholder="Field of study"
            value={form.field_of_study ?? ""}
            onChange={(event) =>
              setForm((current) => ({ ...current, field_of_study: event.target.value }))
            }
            className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)]"
          />
          <div className="flex gap-[var(--spacing-8)]">
            <button
              type="button"
              onClick={() => void submit()}
              className="min-h-11 rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)]"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="min-h-11 rounded-[var(--radius-buttons)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function CertificationsSection({
  items,
  onChanged,
}: {
  items: CertificationEntry[];
  onChanged: (items: CertificationEntry[]) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function startAdd() {
    setForm({ name: "", issuer: "", credential_url: "" });
    setOpen("new");
    setError(null);
  }

  function startEdit(entry: CertificationEntry) {
    setForm({ name: entry.name, issuer: entry.issuer, credential_url: entry.credential_url ?? "" });
    setOpen(entry.id);
    setError(null);
  }

  async function submit() {
    const body = {
      name: form.name,
      issuer: form.issuer,
      credential_url: form.credential_url || undefined,
    };
    const isNew = open === "new";
    const response = await fetch(
      isNew ? "/api/profile/me/certifications" : `/api/profile/me/certifications/${open}`,
      {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(errorBody?.error?.message ?? "Couldn't save this entry.");
      return;
    }
    const saved = (await response.json()) as CertificationEntry;
    onChanged(
      isNew ? [...items, saved] : items.map((entry) => (entry.id === saved.id ? saved : entry)),
    );
    setOpen(null);
  }

  async function remove(id: string) {
    const response = await fetch(`/api/profile/me/certifications/${id}`, { method: "DELETE" });
    if (response.ok) onChanged(items.filter((entry) => entry.id !== id));
    setConfirmDeleteId(null);
  }

  return (
    <section className="flex flex-col gap-[var(--spacing-8)] border-t border-[color:var(--color-mist-gray)] pt-[var(--spacing-16)]">
      <div className="flex items-center justify-between">
        <h2 className="text-[length:var(--text-caption)] font-medium uppercase tracking-wide text-[color:var(--color-graphite)]">
          Certifications
        </h2>
        <button
          type="button"
          onClick={startAdd}
          className="min-h-11 text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)]"
        >
          + Add
        </button>
      </div>

      {items.length === 0 && open !== "new" && (
        <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
          No certifications added yet.
        </p>
      )}

      <ul className="flex flex-col gap-[var(--spacing-8)]">
        {items.map((entry) => (
          <li
            key={entry.id}
            className="flex items-center justify-between gap-[var(--spacing-8)] rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]"
          >
            <span className="text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
              {entry.name}{" "}
              <span className="text-[color:var(--color-graphite)]">· {entry.issuer}</span>
            </span>
            {confirmDeleteId === entry.id ? (
              <div className="flex shrink-0 items-center gap-[var(--spacing-8)]">
                <span className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                  Delete?
                </span>
                <button
                  type="button"
                  onClick={() => void remove(entry.id)}
                  className="min-h-11 text-[length:var(--text-caption)] text-[color:var(--color-danger-text)]"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  className="min-h-11 text-[length:var(--text-caption)] text-[color:var(--color-graphite)]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex shrink-0 gap-[var(--spacing-8)]">
                <button
                  type="button"
                  onClick={() => startEdit(entry)}
                  aria-label="Edit"
                  className="min-h-11 min-w-11"
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(entry.id)}
                  aria-label="Delete"
                  className="min-h-11 min-w-11"
                >
                  🗑
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {open && (
        <div className="flex flex-col gap-[var(--spacing-8)] rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]">
          {error && (
            <p
              role="alert"
              className="text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]"
            >
              {error}
            </p>
          )}
          <input
            placeholder="Certification name"
            value={form.name ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)]"
          />
          <input
            placeholder="Issuer"
            value={form.issuer ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, issuer: event.target.value }))}
            className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)]"
          />
          <input
            placeholder="Credential URL (https://)"
            value={form.credential_url ?? ""}
            onChange={(event) =>
              setForm((current) => ({ ...current, credential_url: event.target.value }))
            }
            className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)]"
          />
          <div className="flex gap-[var(--spacing-8)]">
            <button
              type="button"
              onClick={() => void submit()}
              className="min-h-11 rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)]"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="min-h-11 rounded-[var(--radius-buttons)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function PortfolioSection({
  items,
  onChanged,
}: {
  items: PortfolioEntry[];
  onChanged: (items: PortfolioEntry[]) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function startAdd() {
    setForm({ title: "", url: "" });
    setOpen("new");
    setError(null);
  }

  function startEdit(entry: PortfolioEntry) {
    setForm({ title: entry.title, url: entry.url });
    setOpen(entry.id);
    setError(null);
  }

  async function submit() {
    const body = { title: form.title, url: form.url };
    const isNew = open === "new";
    const response = await fetch(
      isNew ? "/api/profile/me/portfolio" : `/api/profile/me/portfolio/${open}`,
      {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(errorBody?.error?.message ?? "Couldn't save this link.");
      return;
    }
    const saved = (await response.json()) as PortfolioEntry;
    onChanged(
      isNew ? [...items, saved] : items.map((entry) => (entry.id === saved.id ? saved : entry)),
    );
    setOpen(null);
  }

  async function remove(id: string) {
    const response = await fetch(`/api/profile/me/portfolio/${id}`, { method: "DELETE" });
    if (response.ok) onChanged(items.filter((entry) => entry.id !== id));
    setConfirmDeleteId(null);
  }

  return (
    <section className="flex flex-col gap-[var(--spacing-8)] border-t border-[color:var(--color-mist-gray)] pt-[var(--spacing-16)]">
      <div className="flex items-center justify-between">
        <h2 className="text-[length:var(--text-caption)] font-medium uppercase tracking-wide text-[color:var(--color-graphite)]">
          Portfolio
        </h2>
        <button
          type="button"
          onClick={startAdd}
          className="min-h-11 text-[length:var(--text-body-sm)] text-[color:var(--color-iris-blue)]"
        >
          + Add
        </button>
      </div>

      {items.length === 0 && open !== "new" && (
        <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
          No portfolio links added yet.
        </p>
      )}

      <ul className="flex flex-col gap-[var(--spacing-8)]">
        {items.map((entry) => (
          <li
            key={entry.id}
            className="flex items-center justify-between gap-[var(--spacing-8)] rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]"
          >
            <span className="truncate text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]">
              {entry.title}
            </span>
            {confirmDeleteId === entry.id ? (
              <div className="flex shrink-0 items-center gap-[var(--spacing-8)]">
                <span className="text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                  Delete?
                </span>
                <button
                  type="button"
                  onClick={() => void remove(entry.id)}
                  className="min-h-11 text-[length:var(--text-caption)] text-[color:var(--color-danger-text)]"
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  className="min-h-11 text-[length:var(--text-caption)] text-[color:var(--color-graphite)]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex shrink-0 gap-[var(--spacing-8)]">
                <button
                  type="button"
                  onClick={() => startEdit(entry)}
                  aria-label="Edit"
                  className="min-h-11 min-w-11"
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(entry.id)}
                  aria-label="Delete"
                  className="min-h-11 min-w-11"
                >
                  🗑
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {open && (
        <div className="flex flex-col gap-[var(--spacing-8)] rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]">
          {error && (
            <p
              role="alert"
              className="text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]"
            >
              {error}
            </p>
          )}
          <input
            placeholder="Title"
            value={form.title ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)]"
          />
          <input
            placeholder="URL (https://)"
            value={form.url ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
            className="min-h-11 rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)]"
          />
          <div className="flex gap-[var(--spacing-8)]">
            <button
              type="button"
              onClick={() => void submit()}
              className="min-h-11 rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-paper-white)]"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="min-h-11 rounded-[var(--radius-buttons)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] text-[length:var(--text-body-sm)] text-[color:var(--color-ink)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
