import { OAuthLinkForm } from "./oauth-link-form";

export const metadata = {
  robots: { index: false, follow: false },
};

// §13 F1: "OAuth email matches existing account -> explicit link
// confirmation + password check." Reached only via a redirect from
// app/api/auth/oauth/[provider]/callback/route.ts, carrying the
// short-lived link_token as a query param.
export default async function OAuthLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; provider?: string }>;
}) {
  const { token, provider } = await searchParams;
  return <OAuthLinkForm linkToken={token ?? ""} provider={provider ?? ""} />;
}
