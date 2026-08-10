import { PremiumScreen } from "@/components/premium/premium-screen";

export const metadata = { robots: { index: false, follow: false } };

// design.md §14.19 / PRD §13 F11: every paywall trigger links here with
// `?reason=` naming the specific limit and `?return_to=` the blocked
// action's own path — this page is the one place that copy is rendered,
// so "no generic paywall copy exists in the codebase" only has to hold
// in one file.
export default async function PremiumPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; return_to?: string }>;
}) {
  const { reason, return_to: returnTo } = await searchParams;
  return <PremiumScreen reason={reason ?? null} returnTo={returnTo ?? null} />;
}
