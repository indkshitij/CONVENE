// design.md §14.3: "inline field errors replacing helper text" — this
// occupies the same slot a helper/hint line would, not an addition
// alongside one, which is why it's `role="alert"` (announced immediately)
// rather than a generic caption.
export function FieldError({
  children,
  id,
}: {
  children?: string | undefined;
  id?: string | undefined;
}) {
  if (!children) return null;
  return (
    <p
      id={id}
      role="alert"
      className="mt-[var(--spacing-8)] text-[length:var(--text-body-sm)] text-[color:var(--color-danger-text)]"
    >
      {children}
    </p>
  );
}
