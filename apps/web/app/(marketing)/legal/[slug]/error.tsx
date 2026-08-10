"use client";

import { RouteError } from "@/components/shared/route-error";

export default function LegalDocumentError(props: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <RouteError {...props} title="Couldn't load this document" />;
}
