# Runbook: Object storage unavailable

**Alert**: elevated error rate on media upload/serve endpoints
(`apps/api/src/modules/media`).

**Design commitment (§21.9)**: "Existing media served from CDN cache;
uploads disabled with explicit copy."

## What exists today

`apps/api/src/modules/media/services/storage-provider.ts` implements
`StorageProvider` as an interface with one real implementation,
`LocalFilesystemStorageProvider` — its own doc comment states this is a
placeholder ("a real S3/R2 implementation swaps in behind this interface
without touching any caller — same 'local provider now, real backend later'
precedent as P5.1's KeyProvider"). Confirmed during P29.2's security review:
no R2/S3/Cloudflare integration exists anywhere in this codebase yet.

This means the PRD row's premise — "object storage" as a separate, killable
third-party dependency with its own CDN cache layer in front of it — **isn't
applicable to the current implementation**. There's no CDN in front of the
local filesystem provider, so "served from CDN cache" during an outage isn't
a real fallback path today; it would need to be built as part of standing up
the real storage provider, not retrofitted onto the current stub.

## What's verified working today

- **Upload failure handling is real**: `media-processing.service.ts`'s
  pipeline (magic-byte check → AV scan → EXIF strip → derivative generation
  → commit) fails a specific, well-typed error at whichever stage breaks,
  rather than silently succeeding — an upload-path outage would surface as
  a real, catchable error today, not a corrupted/partial media row.
- **No "uploads disabled with explicit copy" UI state was found** in
  `apps/web` — grepped for storage-outage-specific copy, found nothing.
  Upload failures today would surface as apps/web's generic error-toast
  path (`defaultOnError` in `providers/query-provider.tsx`), not a
  dedicated "uploads are temporarily disabled" banner.

## Manual mitigation

1. Until a real object-storage provider and CDN exist, "object storage
   down" in production terms means the local filesystem the API process
   runs on is unwritable/unreadable — treat as a host-level infrastructure
   incident, not an isolated third-party dependency failure.
2. Once a real provider (R2/S3) is integrated: this runbook needs a rewrite
   reflecting the actual provider's own health-check/status-page and the
   real CDN cache-serving behavior in front of it.

## Exercising this drill for real

Not applicable in the current architecture — there is no live object storage
provider to kill. This becomes a real, exercisable drill only after the R2/S3
integration referenced above is built.
