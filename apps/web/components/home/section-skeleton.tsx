// design.md §14.7: "Loading: Skeleton for each section; sections stream
// in independently (no blocking)." Two skeleton shapes matching this
// phase's two card layouts (horizontal carousel vs vertical list) — a
// shape-matched fallback avoids the layout jump a generic spinner would
// cause once real content streams in.
export function CarouselSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex gap-[var(--spacing-16)] overflow-x-hidden"
    >
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="h-40 w-32 shrink-0 animate-pulse rounded-[var(--radius-cards)] bg-[color:var(--color-mist-gray)]"
        />
      ))}
    </div>
  );
}

export function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-[var(--spacing-8)]">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="h-20 w-full animate-pulse rounded-[var(--radius-cards)] bg-[color:var(--color-mist-gray)]"
        />
      ))}
    </div>
  );
}

export function StripSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading" className="flex gap-[var(--spacing-16)]">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="h-16 w-16 shrink-0 animate-pulse rounded-full bg-[color:var(--color-mist-gray)]"
        />
      ))}
    </div>
  );
}
