import { describe, expect, it } from "vitest";
import { ALL_CITIES, COUNTRIES, INDIAN_CITIES, INTERNATIONAL_CITIES } from "./cities";

describe("cities seed data (P2.5)", () => {
  it("has roughly 200 Indian cities plus 50 international", () => {
    expect(INDIAN_CITIES.length).toBeGreaterThanOrEqual(200);
    expect(INTERNATIONAL_CITIES.length).toBeGreaterThanOrEqual(50);
    expect(ALL_CITIES).toHaveLength(INDIAN_CITIES.length + INTERNATIONAL_CITIES.length);
  });

  it("includes Bengaluru with a real centroid, for the Bengaluru-dense population", () => {
    const bengaluru = ALL_CITIES.find((city) => city.name === "Bengaluru");
    expect(bengaluru).toBeDefined();
    expect(bengaluru?.lat).toBeCloseTo(12.9716, 1);
    expect(bengaluru?.lng).toBeCloseTo(77.5946, 1);
    expect(bengaluru?.timezone).toBe("Asia/Kolkata");
  });

  it("every city references a country present in COUNTRIES", () => {
    const validCodes = new Set(COUNTRIES.map((country) => country.code));
    expect(ALL_CITIES.every((city) => validCodes.has(city.countryCode))).toBe(true);
  });

  it("every city has plausible coordinates", () => {
    expect(
      ALL_CITIES.every(
        (city) => city.lat >= -90 && city.lat <= 90 && city.lng >= -180 && city.lng <= 180,
      ),
    ).toBe(true);
  });
});
