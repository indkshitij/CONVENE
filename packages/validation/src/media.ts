import { z } from "zod";

// PRD §16.3 media.kind CHECK constraint, transcribed verbatim.
export const MEDIA_KINDS = [
  "avatar",
  "message_image",
  "message_file",
  "voice",
  "resume",
  "export",
] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

// §17.7 "SVG uploads are refused outright (XSS vector)" — image/svg+xml is
// deliberately absent from every image allowlist below, not merely
// unlisted by omission.
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"] as const;
export const VOICE_MIME_TYPES = ["audio/ogg", "audio/mp4", "audio/mpeg", "audio/webm"] as const;
export const FILE_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
  "application/zip",
] as const;

const ALLOWED_MIME_BY_KIND: Record<MediaKind, readonly string[]> = {
  avatar: IMAGE_MIME_TYPES,
  message_image: IMAGE_MIME_TYPES,
  message_file: FILE_MIME_TYPES,
  voice: VOICE_MIME_TYPES,
  resume: FILE_MIME_TYPES,
  export: FILE_MIME_TYPES,
};

export function isAllowedMimeForKind(kind: MediaKind, mimeType: string): boolean {
  return ALLOWED_MIME_BY_KIND[kind].includes(mimeType);
}

// §10.7.3's own per-kind limits, reused here as the pipeline's ceiling
// (images/files/voice share the same numbers §10.7.3 already gives
// messaging attachments — no separate figure exists for the media
// pipeline specifically).
export const MAX_SIZE_BYTES_BY_KIND: Record<MediaKind, number> = {
  avatar: 10 * 1024 * 1024,
  message_image: 10 * 1024 * 1024,
  message_file: 25 * 1024 * 1024,
  voice: 25 * 1024 * 1024, // §10.7.3 gives a duration cap (3 min), not a byte cap — this is a generous ceiling, not a transcription.
  resume: 25 * 1024 * 1024,
  export: 100 * 1024 * 1024,
};

export const MEDIA_KIND_ERROR = "Unsupported media kind";
export const MEDIA_MIME_ERROR = "This file type isn't supported";
export const MEDIA_SIZE_ERROR = "This file is too large";

export const createUploadIntentSchema = z
  .object({
    kind: z.enum(MEDIA_KINDS, { message: MEDIA_KIND_ERROR }),
    mime_type: z.string().min(1),
    size_bytes: z.number().int().positive(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
  })
  .refine((input) => isAllowedMimeForKind(input.kind, input.mime_type), {
    message: MEDIA_MIME_ERROR,
    path: ["mime_type"],
  })
  .refine((input) => input.size_bytes <= MAX_SIZE_BYTES_BY_KIND[input.kind], {
    message: MEDIA_SIZE_ERROR,
    path: ["size_bytes"],
  });

// §17.7's own commit contract doesn't name a body beyond the media id in
// the path, but `message_image`/`message_file` uploads need a
// conversation to gate the signed serve URL's "participant check"
// against (see migration 0015's own comment) — optional, set only when
// the upload is a message attachment.
export const commitUploadSchema = z.object({
  conversation_id: z.string().optional(),
});
