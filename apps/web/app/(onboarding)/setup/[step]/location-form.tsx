"use client";

import { Label } from "@convene/ui";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { City, ProfileResponse } from "@/lib/api/client";
import { WizardNav } from "@/components/onboarding/wizard-nav";

// design.md §14.6 step 5. BR-LOC-06 free presets; Premium's custom 1-500km
// range isn't offered at this onboarding step — a deliberate scope cut
// (the full plan-aware radius control belongs to search/discover
// settings, not a 30s onboarding step) matching this session's precedent
// of not branching UI on plan mid-onboarding.
const RADIUS_PRESETS_KM = [5, 10, 25, 50, 100] as const;

const REMOTE_PREFERENCE_OPTIONS = [
  { value: "onsite", label: "In person" },
  { value: "hybrid", label: "Hybrid" },
  { value: "remote", label: "Remote" },
  { value: "any", label: "Any" },
] as const;

// BR-LOC-03's own four levels, in plain language (design.md: "privacy
// level selector with plain-language descriptions of each option").
const PRIVACY_OPTIONS = [
  {
    value: "exact",
    label: "Precise",
    description:
      'Rank me by exact distance (still shown to others only as a rounded bucket, like "~5 km away")',
  },
  {
    value: "city_only",
    label: "City only",
    description: "Only my city is used for ranking and shown to others",
  },
  {
    value: "country_only",
    label: "Country only",
    description: "Only my country is used for ranking",
  },
  { value: "hidden", label: "Hidden", description: "Location isn't used to rank me at all" },
] as const;

interface ApiErrorBody {
  error: { message: string };
}

export function LocationForm({ profile }: { profile: ProfileResponse }) {
  const router = useRouter();
  const [citySet, setCitySet] = useState(profile.location.city !== null);
  const [currentCityLabel, setCurrentCityLabel] = useState(profile.location.city);
  const [nearbyUserCount, setNearbyUserCount] = useState<number | null>(null);
  const [gpsDenied, setGpsDenied] = useState(false);
  const [gpsPending, setGpsPending] = useState(false);

  const [cityQuery, setCityQuery] = useState("");
  const [cityResults, setCityResults] = useState<City[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Not readable back from anywhere — GET /profiles/me carries no
  // search_radius_km/remote_preference/open_to_relocate/location_privacy
  // fields, and there's no GET counterpart to PUT /preferences/location or
  // PUT /location/privacy (grepped apps/api's location module). A user
  // revisiting this step (e.g. via Back) sees fresh defaults rather than
  // their prior choices — a documented gap, not a guess dressed up as a
  // read value.
  const [radiusIndex, setRadiusIndex] = useState(2); // 25 km
  const [remotePreference, setRemotePreference] =
    useState<(typeof REMOTE_PREFERENCE_OPTIONS)[number]["value"]>("any");
  const [locationPrivacy, setLocationPrivacy] =
    useState<(typeof PRIVACY_OPTIONS)[number]["value"]>("city_only");

  const [locationError, setLocationError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function requestGpsLocation() {
    setGpsPending(true);
    setLocationError(null);
    if (!("geolocation" in navigator)) {
      setGpsDenied(true);
      setGpsPending(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void (async () => {
          try {
            const response = await fetch("/api/location", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                source: "gps",
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy_m: position.coords.accuracy,
              }),
            });
            if (!response.ok) {
              const body = (await response.json()) as ApiErrorBody;
              setServerError(body.error.message || "Something went wrong. Please try again.");
              return;
            }
            const data = (await response.json()) as {
              city: { name: string } | null;
              nearby_user_count: number;
            };
            setCitySet(true);
            setCurrentCityLabel(data.city?.name ?? null);
            setNearbyUserCount(data.nearby_user_count);
          } catch {
            setServerError("Something went wrong. Please try again.");
          } finally {
            setGpsPending(false);
          }
        })();
      },
      () => {
        // GPS denial is a first-class path (BR-LOC-01), not an error —
        // the manual city picker below is always visible regardless, so
        // this only needs to stop the pending spinner.
        setGpsDenied(true);
        setGpsPending(false);
      },
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  }

  function onCityQueryChange(value: string) {
    setCityQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setCityResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void (async () => {
        const response = await fetch(`/api/taxonomies/cities?q=${encodeURIComponent(value)}`);
        if (response.ok) {
          const data = (await response.json()) as { cities: City[] };
          setCityResults(data.cities);
        }
      })();
    }, 400);
  }

  async function chooseCity(city: City) {
    setLocationError(null);
    setCityResults([]);
    setCityQuery("");
    try {
      const response = await fetch("/api/location/manual", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city_id: city.id }),
      });
      if (!response.ok) {
        const body = (await response.json()) as ApiErrorBody;
        setServerError(body.error.message || "Something went wrong. Please try again.");
        return;
      }
      const data = (await response.json()) as {
        city: { name: string } | null;
        nearby_user_count: number;
      };
      setCitySet(true);
      setCurrentCityLabel(data.city?.name ?? city.name);
      setNearbyUserCount(data.nearby_user_count);
    } catch {
      setServerError("Something went wrong. Please try again.");
    }
  }

  async function onContinue() {
    setServerError(null);
    if (!citySet) {
      setLocationError("Choose a location to continue.");
      return;
    }

    setIsSubmitting(true);
    try {
      const prefsResponse = await fetch("/api/preferences/location", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          search_radius_km: RADIUS_PRESETS_KM[radiusIndex],
          remote_preference: remotePreference,
          // design.md §14.6 step 5's component list doesn't include a
          // relocate toggle (only GPS/manual city, radius, remote
          // preference, privacy) — not built here rather than adding UI
          // beyond spec; open_to_relocate stays false by default and can
          // be changed later in profile settings.
          open_to_relocate: false,
        }),
      });
      if (!prefsResponse.ok) {
        const body = (await prefsResponse.json()) as ApiErrorBody;
        setServerError(body.error.message || "Something went wrong. Please try again.");
        return;
      }

      const privacyResponse = await fetch("/api/location/privacy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location_privacy: locationPrivacy }),
      });
      if (!privacyResponse.ok) {
        const body = (await privacyResponse.json()) as ApiErrorBody;
        setServerError(body.error.message || "Something went wrong. Please try again.");
        return;
      }

      router.push("/setup/6");
    } catch {
      setServerError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-24)]">
      {currentCityLabel && (
        <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
          Current location:{" "}
          <span className="font-medium text-[color:var(--color-ink)]">{currentCityLabel}</span>
        </p>
      )}

      <div className="rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-16)]">
        <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
          We use this to rank people near you — we never share your exact location, and we never
          track you in the background.
        </p>
        <button
          type="button"
          onClick={() => void requestGpsLocation()}
          disabled={gpsPending}
          className="mt-[var(--spacing-16)] min-h-11 w-full rounded-[var(--radius-buttons)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body)] text-[color:var(--color-ink)] disabled:opacity-50"
        >
          {gpsPending ? "Getting your location…" : "Use my current location"}
        </button>
        {gpsDenied && (
          <p className="mt-[var(--spacing-8)] text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
            No problem — pick your city below instead.
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="city-search">Or enter your city</Label>
        <input
          id="city-search"
          type="text"
          value={cityQuery}
          onChange={(event) => onCityQueryChange(event.target.value)}
          placeholder="Search for a city"
          className="min-h-11 w-full rounded-[var(--radius-inputs)] border border-[color:var(--color-mist-gray)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body)] text-[color:var(--color-ink)]"
        />
        {cityResults.length > 0 && (
          <ul className="mt-[var(--spacing-8)] flex flex-col gap-[var(--spacing-8)] rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-8)]">
            {cityResults.map((city) => (
              <li key={city.id}>
                <button
                  type="button"
                  onClick={() => void chooseCity(city)}
                  className="min-h-11 w-full rounded-[var(--radius-inputs)] px-[var(--spacing-16)] py-[var(--spacing-8)] text-left text-[length:var(--text-body-sm)] text-[color:var(--color-ink)] hover:bg-[color:var(--color-mist-gray)]"
                >
                  {city.name}
                  {city.country ? `, ${city.country}` : ""}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {nearbyUserCount !== null && (
        <p className="text-[length:var(--text-body-sm)] text-[color:var(--color-graphite)]">
          {nearbyUserCount} people are near you on Convene.
        </p>
      )}

      <div>
        <Label htmlFor="radius">Search radius: {RADIUS_PRESETS_KM[radiusIndex]} km</Label>
        <input
          id="radius"
          type="range"
          min={0}
          max={RADIUS_PRESETS_KM.length - 1}
          step={1}
          value={radiusIndex}
          onChange={(event) => setRadiusIndex(Number(event.target.value))}
          className="min-h-11 w-full"
        />
      </div>

      <fieldset>
        <legend className="mb-[var(--spacing-8)] text-[length:var(--text-body-sm)] font-medium text-[color:var(--color-ink)]">
          Remote preference
        </legend>
        <div className="flex flex-wrap gap-[var(--spacing-8)]">
          {REMOTE_PREFERENCE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={remotePreference === option.value}
              onClick={() => setRemotePreference(option.value)}
              className={`min-h-11 rounded-[var(--radius-tags)] border px-[var(--spacing-16)] py-[var(--spacing-8)] text-[length:var(--text-body-sm)] ${remotePreference === option.value ? "border-[color:var(--color-iris-blue)] bg-[color:var(--color-lavender-wash)] text-[color:var(--color-ink)]" : "border-[color:var(--color-mist-gray)] text-[color:var(--color-ink)]"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-[var(--spacing-8)] text-[length:var(--text-body-sm)] font-medium text-[color:var(--color-ink)]">
          Who can see your location
        </legend>
        <div className="flex flex-col gap-[var(--spacing-8)]">
          {PRIVACY_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex min-h-11 items-start gap-[var(--spacing-8)] rounded-[var(--radius-cards)] border border-[color:var(--color-mist-gray)] p-[var(--spacing-8)]"
            >
              <input
                type="radio"
                name="location_privacy"
                value={option.value}
                checked={locationPrivacy === option.value}
                onChange={() => setLocationPrivacy(option.value)}
                className="mt-1"
              />
              <span>
                <span className="block text-[length:var(--text-body-sm)] font-medium text-[color:var(--color-ink)]">
                  {option.label}
                </span>
                <span className="block text-[length:var(--text-caption)] text-[color:var(--color-graphite)]">
                  {option.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {locationError && (
        <p
          role="alert"
          className="text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]"
        >
          {locationError}
        </p>
      )}
      {serverError && (
        <p
          role="alert"
          className="text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]"
        >
          {serverError}
        </p>
      )}

      <button
        type="button"
        onClick={() => void onContinue()}
        disabled={isSubmitting}
        className="min-h-11 w-full rounded-[var(--radius-buttons)] bg-[color:var(--color-charcoal)] px-8 py-3 text-[length:var(--text-body)] text-[color:var(--color-paper-white)] disabled:opacity-50"
      >
        {isSubmitting ? "Saving…" : "Continue"}
      </button>

      <WizardNav backHref="/setup/4" />
    </div>
  );
}
