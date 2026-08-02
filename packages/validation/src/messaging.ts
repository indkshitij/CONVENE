import { z } from "zod";

// §10.7 has no dedicated "Validation Rules" table (unlike §10.1/§10.2/
// §10.3/§10.4/§10.6) — these schemas are derived from §10.7.3's Feature
// Specification table (the "Limits" column) instead of a Validation Rules
// row. That table gives limits and rules, not exact error copy, so the
// messages below are plain descriptive text, not a transcription.

// PRD §10.7.3 "Text": "4,000 chars."
export const MESSAGE_BODY_ERROR = "Messages can't be longer than 4,000 characters";
export const messageBodySchema = z.string().min(1).max(4000, MESSAGE_BODY_ERROR);

// PRD §10.7.3 "Images": "≤ 10 MB, ≤ 5 per message." "Files": "≤ 25 MB."
// "Voice notes": "≤ 3 min." Metadata-only — actual bytes are validated by
// the media pipeline (§17.7).
export const ATTACHMENT_ERROR = "That attachment doesn't meet the size limit";

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const FILE_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
  "application/zip",
]);

const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const FILE_MAX_BYTES = 25 * 1024 * 1024;
const VOICE_NOTE_MAX_SECONDS = 3 * 60;

export const imageAttachmentSchema = z
  .object({ mimeType: z.string(), sizeBytes: z.number() })
  .refine((meta) => IMAGE_MIME_TYPES.has(meta.mimeType), ATTACHMENT_ERROR)
  .refine((meta) => meta.sizeBytes <= IMAGE_MAX_BYTES, ATTACHMENT_ERROR);

export const fileAttachmentSchema = z
  .object({ mimeType: z.string(), sizeBytes: z.number() })
  .refine((meta) => FILE_MIME_TYPES.has(meta.mimeType), ATTACHMENT_ERROR)
  .refine((meta) => meta.sizeBytes <= FILE_MAX_BYTES, ATTACHMENT_ERROR);

export const voiceNoteSchema = z
  .object({ durationSeconds: z.number() })
  .refine((meta) => meta.durationSeconds <= VOICE_NOTE_MAX_SECONDS, ATTACHMENT_ERROR);

export const MESSAGE_IMAGE_COUNT_ERROR = "You can attach up to 5 images per message";
export const imageAttachmentsListSchema = z
  .array(imageAttachmentSchema)
  .max(5, MESSAGE_IMAGE_COUNT_ERROR);

// PRD §10.7.3 "Reactions": "One emoji per user per message from a 12-emoji
// set." The PRD doesn't enumerate the 12 emoji — this set is an
// assumption, not a transcription, flagged here and in the PR description.
export const REACTION_EMOJI = [
  "👍",
  "❤️",
  "😂",
  "😮",
  "😢",
  "🙏",
  "👏",
  "🔥",
  "💯",
  "🎉",
  "🤝",
  "👀",
] as const;
export const REACTION_EMOJI_ERROR = "Choose one of the supported reaction emoji";
export const reactionEmojiSchema = z.enum(REACTION_EMOJI, { message: REACTION_EMOJI_ERROR });

// PRD §10.7.3 "Forward": "Only to conversations the user is a member of
// [DB check, not modelled here] ... ≤ 3 conversations at once."
export const FORWARD_CONVERSATIONS_ERROR = "You can forward to up to 3 conversations at once";
export const forwardConversationIdsSchema = z
  .array(z.string())
  .min(1)
  .max(3, FORWARD_CONVERSATIONS_ERROR);

// PRD §10.7.3 "Edit": "Own text messages only, within 15 min, max 3
// edits." Ownership, the 15-minute window, and the edit count are all
// state the message row carries (author, created_at, edit_count) — not
// expressible in an isolated input schema. This validates only the new
// body's shape; the messaging service enforces the rest at request time.
export const editMessageSchema = z.object({
  body: messageBodySchema,
});

export const sendMessageSchema = z.object({
  conversation_id: z.string(),
  client_msg_id: z.string(),
  body: messageBodySchema,
  reply_to_id: z.string().optional(),
  attachment_media_ids: z.array(z.string()).optional(),
});
