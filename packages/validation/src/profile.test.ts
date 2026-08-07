import { describe, expect, it } from "vitest";
import {
  ABOUT_ERROR,
  AVATAR_ERROR,
  EXPERIENCE_END_DATE_ERROR,
  EXPERIENCE_START_DATE_ERROR,
  HEADLINE_ERROR,
  INTERESTS_ERROR,
  LANGUAGES_ERROR,
  PORTFOLIO_URL_ERROR,
  RESUME_ERROR,
  SKILL_ERROR,
  aboutSchema,
  avatarMetadataSchema,
  certificationCreateSchema,
  educationCreateSchema,
  experienceCreateSchema,
  experienceEntrySchema,
  experienceUpdateSchema,
  headlineSchema,
  interestsListSchema,
  languagesListSchema,
  portfolioItemCreateSchema,
  portfolioUrlSchema,
  profileUpdateSchema,
  resumeMetadataSchema,
  skillsListSchema,
  skillsReplaceSchema,
  socialLinksSchema,
} from "./profile";

describe("headlineSchema", () => {
  it("accepts a valid headline", () => {
    expect(headlineSchema.safeParse("Backend engineer building payments infra").success).toBe(true);
  });

  it("rejects a headline under 10 chars", () => {
    const result = headlineSchema.safeParse("Engineer");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(HEADLINE_ERROR);
  });

  it("rejects a headline over 120 chars", () => {
    const result = headlineSchema.safeParse("E".repeat(121));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(HEADLINE_ERROR);
  });

  it("rejects a headline containing an email", () => {
    const result = headlineSchema.safeParse("Reach me at ananya@example.com for roles");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(HEADLINE_ERROR);
  });

  it("rejects a headline containing a URL", () => {
    const result = headlineSchema.safeParse("Portfolio at https://ananya.dev right here");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(HEADLINE_ERROR);
  });

  it("rejects a headline with more than 2 emoji", () => {
    const result = headlineSchema.safeParse("Backend engineer 🚀🔥💯 building things");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(HEADLINE_ERROR);
  });

  it("rejects an all-caps headline", () => {
    const result = headlineSchema.safeParse("BACKEND ENGINEER BUILDING PAYMENTS INFRA");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(HEADLINE_ERROR);
  });
});

describe("aboutSchema", () => {
  it("accepts valid about text with up to 3 URLs", () => {
    const result = aboutSchema.safeParse(
      "Check https://a.com, https://b.com and https://c.com for my work.",
    );
    expect(result.success).toBe(true);
  });

  it("rejects text over 2000 chars", () => {
    const result = aboutSchema.safeParse("a".repeat(2001));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(ABOUT_ERROR);
  });

  it("rejects text containing a phone number", () => {
    const result = aboutSchema.safeParse("Call me at +91 98765 43210 anytime");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(ABOUT_ERROR);
  });

  it("rejects text with more than 3 URLs", () => {
    const result = aboutSchema.safeParse("https://a.com https://b.com https://c.com https://d.com");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(ABOUT_ERROR);
  });
});

describe("skillsListSchema", () => {
  it("accepts a valid list of skills", () => {
    expect(skillsListSchema.safeParse(["React", "TypeScript", "Node.js"]).success).toBe(true);
  });

  it("rejects more than 30 skills", () => {
    const result = skillsListSchema.safeParse(Array.from({ length: 31 }, (_, i) => `Skill${i}`));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(SKILL_ERROR);
  });

  it("rejects case-insensitive duplicate skills", () => {
    const result = skillsListSchema.safeParse(["React", "react"]);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(SKILL_ERROR);
  });

  it("rejects a skill under 2 chars", () => {
    const result = skillsListSchema.safeParse(["R"]);
    expect(result.success).toBe(false);
  });
});

describe("experienceEntrySchema", () => {
  const dob = new Date("2003-04-11");
  const now = new Date("2026-08-02");

  it("accepts a valid current-role entry", () => {
    const result = experienceEntrySchema(dob, now).safeParse({
      start_date: "2024-01-01",
      end_date: null,
      is_current: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid past-role entry", () => {
    const result = experienceEntrySchema(dob, now).safeParse({
      start_date: "2020-01-01",
      end_date: "2022-01-01",
      is_current: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a start_date before DOB + 14 years", () => {
    const result = experienceEntrySchema(dob, now).safeParse({
      start_date: "2010-01-01",
      end_date: null,
      is_current: true,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(EXPERIENCE_START_DATE_ERROR);
  });

  it("rejects a start_date in the future", () => {
    const result = experienceEntrySchema(dob, now).safeParse({
      start_date: "2027-01-01",
      end_date: null,
      is_current: true,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(EXPERIENCE_START_DATE_ERROR);
  });

  it("rejects end_date before start_date", () => {
    const result = experienceEntrySchema(dob, now).safeParse({
      start_date: "2022-01-01",
      end_date: "2021-01-01",
      is_current: false,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(EXPERIENCE_END_DATE_ERROR);
  });

  it("rejects is_current=true with a non-null end_date", () => {
    const result = experienceEntrySchema(dob, now).safeParse({
      start_date: "2022-01-01",
      end_date: "2023-01-01",
      is_current: true,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(EXPERIENCE_END_DATE_ERROR);
  });

  it("rejects is_current=false with a null end_date", () => {
    const result = experienceEntrySchema(dob, now).safeParse({
      start_date: "2022-01-01",
      end_date: null,
      is_current: false,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(EXPERIENCE_END_DATE_ERROR);
  });
});

describe("portfolioUrlSchema", () => {
  it("accepts a valid https URL", () => {
    expect(portfolioUrlSchema.safeParse("https://ananya.dev/projects").success).toBe(true);
  });

  it("rejects a non-https URL", () => {
    const result = portfolioUrlSchema.safeParse("http://ananya.dev/projects");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(PORTFOLIO_URL_ERROR);
  });
});

describe("socialLinksSchema", () => {
  it("accepts a valid set of social links", () => {
    const result = socialLinksSchema.safeParse({
      linkedin: "https://www.linkedin.com/in/ananya",
      github: "https://github.com/ananya",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a linkedin URL with the wrong host", () => {
    const result = socialLinksSchema.safeParse({ linkedin: "https://notlinkedin.com/in/ananya" });
    expect(result.success).toBe(false);
  });
});

describe("avatarMetadataSchema", () => {
  it("accepts a valid avatar", () => {
    const result = avatarMetadataSchema.safeParse({
      mimeType: "image/jpeg",
      sizeBytes: 1_000_000,
      width: 512,
      height: 512,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unsupported mime type", () => {
    const result = avatarMetadataSchema.safeParse({
      mimeType: "image/gif",
      sizeBytes: 1_000_000,
      width: 512,
      height: 512,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(AVATAR_ERROR);
  });

  it("rejects a file over 5 MB", () => {
    const result = avatarMetadataSchema.safeParse({
      mimeType: "image/jpeg",
      sizeBytes: 6 * 1024 * 1024,
      width: 512,
      height: 512,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(AVATAR_ERROR);
  });

  it("rejects an image smaller than 200x200", () => {
    const result = avatarMetadataSchema.safeParse({
      mimeType: "image/jpeg",
      sizeBytes: 1_000_000,
      width: 100,
      height: 100,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(AVATAR_ERROR);
  });
});

describe("resumeMetadataSchema", () => {
  it("accepts a valid resume", () => {
    const result = resumeMetadataSchema.safeParse({
      mimeType: "application/pdf",
      sizeBytes: 1_000_000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unsupported file type", () => {
    const result = resumeMetadataSchema.safeParse({ mimeType: "text/plain", sizeBytes: 1_000_000 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(RESUME_ERROR);
  });

  it("rejects a file over 10 MB", () => {
    const result = resumeMetadataSchema.safeParse({
      mimeType: "application/pdf",
      sizeBytes: 11 * 1024 * 1024,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(RESUME_ERROR);
  });
});

describe("profileUpdateSchema", () => {
  it("accepts a partial update with just one field", () => {
    const result = profileUpdateSchema.safeParse({
      headline: "Backend engineer building payments infra",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty object (no-op update)", () => {
    expect(profileUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("rejects an unknown field", () => {
    const result = profileUpdateSchema.safeParse({ coordinates: { lat: 1, lng: 2 } });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid headline within a partial update", () => {
    const result = profileUpdateSchema.safeParse({ headline: "short" });
    expect(result.success).toBe(false);
  });

  it("accepts a full set of scalar fields", () => {
    const result = profileUpdateSchema.safeParse({
      full_name: "Ananya Rao",
      headline: "Director of Data Science, NLP & applied LLMs",
      about: "Sixteen years building NLP systems.",
      industry_id: 3,
      job_title: "Director of Data Science",
      company_name: "Xenon Labs",
      employment_type: "full_time",
      years_experience: 16,
      years_experience_override: false,
      timezone: "Asia/Kolkata",
      remote_preference: "hybrid",
      open_to_relocate: false,
    });
    expect(result.success).toBe(true);
  });
});

describe("experienceCreateSchema", () => {
  const dob = new Date("2003-04-11");
  const now = new Date("2026-08-02");

  it("accepts a valid current-role entry", () => {
    const result = experienceCreateSchema(dob, now).safeParse({
      company_name: "Xenon Labs",
      title: "Director of Data Science",
      start_date: "2021-03-01",
      end_date: null,
      is_current: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing company_name", () => {
    const result = experienceCreateSchema(dob, now).safeParse({
      title: "Director",
      start_date: "2021-03-01",
      end_date: null,
      is_current: true,
    });
    expect(result.success).toBe(false);
  });

  it("still enforces the cross-field date rule inherited from experienceEntrySchema", () => {
    const result = experienceCreateSchema(dob, now).safeParse({
      company_name: "Xenon Labs",
      title: "Director",
      start_date: "2021-03-01",
      end_date: "2020-01-01",
      is_current: false,
    });
    expect(result.success).toBe(false);
  });
});

describe("experienceUpdateSchema", () => {
  it("accepts a partial update touching only one field", () => {
    expect(experienceUpdateSchema.safeParse({ title: "Senior Director" }).success).toBe(true);
  });

  it("rejects an unknown field", () => {
    expect(experienceUpdateSchema.safeParse({ coordinates: { lat: 1, lng: 2 } }).success).toBe(
      false,
    );
  });
});

describe("educationCreateSchema", () => {
  it("accepts a minimal valid entry", () => {
    expect(educationCreateSchema.safeParse({ school: "IIT Madras" }).success).toBe(true);
  });

  it("rejects a missing school", () => {
    expect(educationCreateSchema.safeParse({ degree: "M.Tech" }).success).toBe(false);
  });
});

describe("certificationCreateSchema", () => {
  it("accepts a valid entry", () => {
    const result = certificationCreateSchema.safeParse({
      name: "AWS Certified Solutions Architect",
      issuer: "Amazon Web Services",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-https credential_url", () => {
    const result = certificationCreateSchema.safeParse({
      name: "Cert",
      issuer: "Issuer",
      credential_url: "http://example.com/cert",
    });
    expect(result.success).toBe(false);
  });
});

describe("portfolioItemCreateSchema", () => {
  it("accepts a valid entry", () => {
    const result = portfolioItemCreateSchema.safeParse({
      title: "Talk: LLM evals in production",
      url: "https://example.com/talk",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-https url", () => {
    const result = portfolioItemCreateSchema.safeParse({
      title: "Talk",
      url: "http://example.com/talk",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(PORTFOLIO_URL_ERROR);
  });
});

describe("interestsListSchema", () => {
  it("accepts up to 15 interests", () => {
    expect(interestsListSchema.safeParse(["Cycling", "Mentoring"]).success).toBe(true);
  });

  it("rejects more than 15 interests", () => {
    const result = interestsListSchema.safeParse(
      Array.from({ length: 16 }, (_, i) => `Interest${i}`),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(INTERESTS_ERROR);
  });

  it("rejects case-insensitive duplicates", () => {
    const result = interestsListSchema.safeParse(["Cycling", "cycling"]);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(INTERESTS_ERROR);
  });
});

describe("languagesListSchema", () => {
  it("accepts a valid list", () => {
    const result = languagesListSchema.safeParse([{ code: "en", proficiency: "native" }]);
    expect(result.success).toBe(true);
  });

  it("rejects more than 8 languages", () => {
    const result = languagesListSchema.safeParse(
      Array.from({ length: 9 }, () => ({ code: "en", proficiency: "native" as const })),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an unrecognised proficiency value", () => {
    const result = languagesListSchema.safeParse([{ code: "en", proficiency: "professional" }]);
    expect(result.success).toBe(false);
  });

  it("rejects duplicate language codes", () => {
    const result = languagesListSchema.safeParse([
      { code: "en", proficiency: "native" },
      { code: "en", proficiency: "basic" },
    ]);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(LANGUAGES_ERROR);
  });
});

describe("skillsReplaceSchema", () => {
  it("accepts a valid full-replace payload", () => {
    const result = skillsReplaceSchema.safeParse({
      skills: [{ name: "NLP", proficiency: "expert", years: 9 }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects more than 30 skill entries", () => {
    const result = skillsReplaceSchema.safeParse({
      skills: Array.from({ length: 31 }, (_, i) => ({ name: `Skill${i}` })),
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate skill names case-insensitively", () => {
    const result = skillsReplaceSchema.safeParse({
      skills: [{ name: "React" }, { name: "react" }],
    });
    expect(result.success).toBe(false);
  });
});
