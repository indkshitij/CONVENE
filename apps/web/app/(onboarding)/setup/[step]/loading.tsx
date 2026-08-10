import { SkeletonBlock } from "@/components/shared/route-skeleton";

export default function OnboardingStepLoading() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-[var(--spacing-24)] py-[var(--spacing-40)]">
      <div className="flex w-full max-w-lg flex-col gap-[var(--spacing-16)]">
        <SkeletonBlock className="h-3 w-24" />
        <SkeletonBlock className="h-8 w-2/3" />
      </div>
    </main>
  );
}
