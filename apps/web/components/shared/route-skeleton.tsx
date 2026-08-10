// Shared shimmer-block primitive so every route's loading.tsx can build a
// skeleton shape-matched to its final layout (§18.2's own requirement)
// without repeating the same pulse/surface styling. No hard-coded colors
// or spacing — every value routes through @convene/tokens CSS variables.
export function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-[var(--radius-lg)] bg-[color:var(--surface-mist-section)] ${className ?? ""}`}
    />
  );
}

// A generic "content list" shape — a title-width bar plus a few
// paragraph-width bars — reused by any placeholder route whose final
// content isn't built yet (this phase only ships route placeholders).
export function ContentSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-[var(--spacing-24)] px-[var(--spacing-24)] py-[var(--spacing-80)]">
      <div className="mx-auto flex w-full max-w-(--page-max-width) flex-col gap-[var(--spacing-16)]">
        <SkeletonBlock className="h-10 w-2/3" />
        <SkeletonBlock className="h-4 w-full" />
        <SkeletonBlock className="h-4 w-5/6" />
      </div>
    </div>
  );
}

// A card-grid shape (list-of-entities routes: discover, chats, requests).
export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="flex flex-1 flex-col gap-[var(--spacing-24)] px-[var(--spacing-24)] py-[var(--spacing-40)]">
      <div className="mx-auto grid w-full max-w-(--page-max-width) grid-cols-1 gap-[var(--element-gap)] sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: count }, (_, i) => (
          <SkeletonBlock key={i} className="h-40 w-full" />
        ))}
      </div>
    </div>
  );
}
