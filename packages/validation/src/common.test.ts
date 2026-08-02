import { describe, expect, it } from "vitest";
import {
  DOB_ERROR,
  DURATION_MINUTES_ERROR,
  LATITUDE_ERROR,
  LONGITUDE_ERROR,
  OTP_ERROR,
  PASSWORD_ERROR,
  PHONE_ERROR,
  TIMEZONE_ERROR,
  dobAdultSchema,
  durationMinutesSchema,
  latitudeSchema,
  longitudeSchema,
  otpSchema,
  passwordSchema,
  phoneE164Schema,
  socialLinkUrlSchema,
  timezoneSchema,
} from "./common";

describe("passwordSchema", () => {
  it("accepts a valid password", () => {
    expect(passwordSchema.safeParse("correct-horse-9").success).toBe(true);
  });

  it("rejects a password under 10 chars", () => {
    const result = passwordSchema.safeParse("short1a");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(PASSWORD_ERROR);
  });

  it("rejects a password with no number", () => {
    const result = passwordSchema.safeParse("noNumbersHere");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(PASSWORD_ERROR);
  });

  it("rejects a password with no letter", () => {
    const result = passwordSchema.safeParse("12345678901234");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(PASSWORD_ERROR);
  });

  it("rejects a password over 128 chars", () => {
    const result = passwordSchema.safeParse(`a1${"x".repeat(130)}`);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(PASSWORD_ERROR);
  });
});

describe("phoneE164Schema", () => {
  it("accepts a valid E.164 mobile number", () => {
    expect(phoneE164Schema.safeParse("+919876543210").success).toBe(true);
  });

  it("rejects a landline number", () => {
    const result = phoneE164Schema.safeParse("+911123456789");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(PHONE_ERROR);
  });

  it("rejects a non-E.164 string", () => {
    const result = phoneE164Schema.safeParse("not-a-phone-number");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(PHONE_ERROR);
  });
});

describe("otpSchema", () => {
  it("accepts exactly 6 digits", () => {
    expect(otpSchema.safeParse("123456").success).toBe(true);
  });

  it("rejects fewer than 6 digits", () => {
    const result = otpSchema.safeParse("12345");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(OTP_ERROR);
  });

  it("rejects non-numeric characters", () => {
    const result = otpSchema.safeParse("12345a");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(OTP_ERROR);
  });
});

describe("dobAdultSchema", () => {
  const now = new Date("2026-08-02T00:00:00Z");

  it("accepts a DOB indicating age 23", () => {
    expect(dobAdultSchema(now).safeParse("2003-04-11").success).toBe(true);
  });

  it("rejects a DOB indicating age 17", () => {
    const result = dobAdultSchema(now).safeParse("2009-04-11");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(DOB_ERROR);
  });

  it("rejects a DOB indicating age over 100", () => {
    const result = dobAdultSchema(now).safeParse("1900-01-01");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(DOB_ERROR);
  });

  it("rejects an invalid date string", () => {
    const result = dobAdultSchema(now).safeParse("not-a-date");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(DOB_ERROR);
  });
});

describe("timezoneSchema", () => {
  it("accepts a valid IANA timezone", () => {
    expect(timezoneSchema.safeParse("Asia/Kolkata").success).toBe(true);
  });

  it("rejects an unknown timezone", () => {
    const result = timezoneSchema.safeParse("Not/A_Timezone");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(TIMEZONE_ERROR);
  });
});

describe("latitudeSchema / longitudeSchema", () => {
  it("accepts valid coordinates", () => {
    expect(latitudeSchema.safeParse(23.1815).success).toBe(true);
    expect(longitudeSchema.safeParse(79.9864).success).toBe(true);
  });

  it("rejects an out-of-range latitude", () => {
    const result = latitudeSchema.safeParse(91);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(LATITUDE_ERROR);
  });

  it("rejects an out-of-range longitude", () => {
    const result = longitudeSchema.safeParse(-181);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(LONGITUDE_ERROR);
  });
});

describe("durationMinutesSchema", () => {
  it("accepts a standard-plan enum value", () => {
    expect(durationMinutesSchema(false).safeParse(30).success).toBe(true);
  });

  it("rejects a non-enum value on the standard plan", () => {
    const result = durationMinutesSchema(false).safeParse(45);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(DURATION_MINUTES_ERROR);
  });

  it("accepts any value 1-240 on the premium plan", () => {
    expect(durationMinutesSchema(true).safeParse(180).success).toBe(true);
  });

  it("rejects a value over 240 even on the premium plan", () => {
    const result = durationMinutesSchema(true).safeParse(241);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(DURATION_MINUTES_ERROR);
  });
});

describe("socialLinkUrlSchema", () => {
  it("accepts a valid https LinkedIn URL", () => {
    expect(
      socialLinkUrlSchema("linkedin").safeParse("https://www.linkedin.com/in/ananya").success,
    ).toBe(true);
  });

  it("rejects a non-LinkedIn host for the linkedin provider", () => {
    const result = socialLinkUrlSchema("linkedin").safeParse("https://example.com/ananya");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("That doesn't look like a LinkedIn URL");
  });

  it("rejects a non-https URL", () => {
    const result = socialLinkUrlSchema("github").safeParse("http://github.com/ananya");
    expect(result.success).toBe(false);
  });

  it("accepts any https URL for personal_website", () => {
    expect(socialLinkUrlSchema("personal_website").safeParse("https://ananya.dev").success).toBe(
      true,
    );
  });
});
