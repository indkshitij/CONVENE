import Link from "next/link";

// design.md §15.1 D5: "Availability is the loudest thing on screen — the
// green state is the only place we use a saturated, pulsing accent."
// The real availability control (state machine, countdown) is P21.1's
// scope — this phase only needs the FAB to exist, be centred/elevated in
// the tab bar, and link somewhere real. §15.10: touch targets >=44x44px.
export function AvailableFab() {
  return (
    <Link
      href="/home"
      aria-label="Go available"
      className="flex h-14 w-14 -translate-y-4 items-center justify-center rounded-[var(--radius-full-2)] bg-[color:var(--color-sky-blue)] text-[color:var(--color-paper-white)] shadow-[var(--shadow-lg)]"
    >
      <span aria-hidden="true" className="text-[length:var(--text-heading-sm)] leading-none">
        ●
      </span>
    </Link>
  );
}
