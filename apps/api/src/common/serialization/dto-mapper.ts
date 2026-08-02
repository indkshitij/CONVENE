// PRD §17.9: "DtoMapper is an explicit whitelist — construct responses by
// picking fields, never by spreading an entity." Combined with CLAUDE.md's
// "never serialise coordinates" rule, `coordinates` is excluded both at the
// type level (TKeys can't include it, so passing it is a compile error) and
// at runtime (defence in depth against an `as any` cast bypassing the type
// check) — this is the mechanism that makes leaking a location structurally
// impossible, not just a convention.
const FORBIDDEN_KEYS = new Set(["coordinates"]);

export function mapToDto<
  TEntity extends object,
  TKeys extends Exclude<keyof TEntity, "coordinates">,
>(entity: TEntity, keys: readonly TKeys[]): Pick<TEntity, TKeys> {
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(String(key))) {
      throw new Error(
        `mapToDto: "${String(key)}" is never allowed in a response whitelist (coordinates must not be serialised).`,
      );
    }
  }

  const result = {} as Pick<TEntity, TKeys>;
  for (const key of keys) {
    result[key] = entity[key];
  }
  return result;
}
