// PRD §20.3: "Entitlements are resolved server-side from the subscription
// record on every gated action — never trusted from the JWT or the
// client." This function only decides given an already-fetched
// entitlements map (from `plans.entitlements`, §16.3); a boolean flag
// entitlement is true/false, a numeric quota entitlement is "has any left."
export function hasEntitlement(
  entitlements: Readonly<Record<string, boolean | number>>,
  key: string,
): boolean {
  const value = entitlements[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  return false;
}
