import { clamp } from "../types";

// PRD §11.5.4: "native 1.0, professional 0.85, conv 0.6, basic 0.3."
export type LanguageProficiency = "native" | "professional" | "conversational" | "basic";

const PROFICIENCY_WEIGHTS: Record<LanguageProficiency, number> = {
  native: 1.0,
  professional: 0.85,
  conversational: 0.6,
  basic: 0.3,
};

export interface LanguageEntry {
  code: string;
  proficiency: LanguageProficiency;
}

// PRD §11.5.4: "shared = languages in common weighted by min(proficiency);
// if none shared: return 0.0; return clamp(maxSharedProficiencyWeight, 0, 1)."
export function languagesScore(
  viewerLanguages: readonly LanguageEntry[],
  candidateLanguages: readonly LanguageEntry[],
): number {
  const candidateProficiencyByCode = new Map(
    candidateLanguages.map((lang) => [lang.code, lang.proficiency]),
  );

  let maxSharedWeight = 0;
  let hasSharedLanguage = false;

  for (const viewerLang of viewerLanguages) {
    const candidateProficiency = candidateProficiencyByCode.get(viewerLang.code);
    if (candidateProficiency === undefined) continue;

    hasSharedLanguage = true;
    const sharedWeight = Math.min(
      PROFICIENCY_WEIGHTS[viewerLang.proficiency],
      PROFICIENCY_WEIGHTS[candidateProficiency],
    );
    maxSharedWeight = Math.max(maxSharedWeight, sharedWeight);
  }

  if (!hasSharedLanguage) return 0.0;
  return clamp(maxSharedWeight, 0, 1);
}
