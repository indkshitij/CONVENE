"use client";

// global-error replaces the root layout when active, so (unlike every
// other error.tsx in this app) it must define its own <html>/<body>.
export default function GlobalError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <div
          style={{
            display: "flex",
            minHeight: "100vh",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "16px",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h2>Something went wrong</h2>
          <button type="button" onClick={() => unstable_retry()}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
