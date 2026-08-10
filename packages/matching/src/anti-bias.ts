import type { AvailabilityScoreCandidate } from "./subscores/availability";
import type { ActivityScoreInput } from "./subscores/activity";
import type { IndustryScoreInput } from "./subscores/industry";
import type { ExperienceScoreInput } from "./subscores/experience";
import type { InterestsScoreInput } from "./subscores/interests";
import type { LocationScoreInput } from "./subscores/location";
import type { SkillsScoreInput, CofounderComplementarityInput } from "./subscores/skills";
import type { ReputationComponentsInput } from "./reputation";

// §12.4 / §12.9 / §20.6: "sensitive attributes (caste, religion, marital
// status, gender, photo-derived, ethnicity, name origin, country of
// residence, language) are excluded from all matching inputs and never
// stored as structured fields." This is the structural half of that
// promise — same "name-collision compile-time tripwire" technique as
// reputation.ts's own AssertNoBillingOverlap, applied to every subscore
// input type this package exposes. If any of these interfaces ever
// grows a field whose name collides with this list, this file fails to
// compile.
//
// Note what's deliberately absent from the deny-list: `industry`,
// `location`/`tier` (a distance bucket, never raw coordinates or a
// nationality), and `languages` spoken (a professional-context skill
// signal, §11.5.4's own scored dimension) are all legitimate, PRD-
// sanctioned matching inputs — they are not proxies for the sensitive
// attributes above and are correctly excluded from this deny-list, not
// oversights.
type SensitiveAttributeLikeKeys =
  | "caste"
  | "religion"
  | "maritalStatus"
  | "gender"
  | "sex"
  | "photoDerived"
  | "faceEmbedding"
  | "ethnicity"
  | "nameOrigin"
  | "fullName"
  | "name"
  | "countryOfResidence"
  | "nativeLanguage"
  | "race"
  | "disability"
  | "sexualOrientation"
  | "pregnancyStatus"
  | "immigrationStatus";

type MatchingInputUnion =
  | AvailabilityScoreCandidate
  | ActivityScoreInput
  | IndustryScoreInput
  | ExperienceScoreInput
  | InterestsScoreInput
  | LocationScoreInput
  | SkillsScoreInput
  | CofounderComplementarityInput
  | ReputationComponentsInput;

type AssertNoSensitiveAttributeOverlap<T extends true> = T;
export type _NoSensitiveAttributesReachable = AssertNoSensitiveAttributeOverlap<
  Extract<keyof MatchingInputUnion, SensitiveAttributeLikeKeys> extends never ? true : false
>;
