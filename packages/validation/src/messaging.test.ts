import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_ERROR,
  FORWARD_CONVERSATIONS_ERROR,
  MESSAGE_BODY_ERROR,
  MESSAGE_IMAGE_COUNT_ERROR,
  REACTION_EMOJI_ERROR,
  fileAttachmentSchema,
  forwardConversationIdsSchema,
  imageAttachmentSchema,
  imageAttachmentsListSchema,
  messageBodySchema,
  reactionEmojiSchema,
  sendMessageSchema,
  voiceNoteSchema,
} from "./messaging";

describe("messageBodySchema", () => {
  it("accepts a valid message body", () => {
    expect(messageBodySchema.safeParse("Hey, great to connect!").success).toBe(true);
  });

  it("rejects a body over 4000 chars", () => {
    const result = messageBodySchema.safeParse("a".repeat(4001));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(MESSAGE_BODY_ERROR);
  });
});

describe("imageAttachmentSchema", () => {
  it("accepts a valid image", () => {
    expect(
      imageAttachmentSchema.safeParse({ mimeType: "image/jpeg", sizeBytes: 1_000_000 }).success,
    ).toBe(true);
  });

  it("rejects an unsupported mime type", () => {
    const result = imageAttachmentSchema.safeParse({ mimeType: "image/gif", sizeBytes: 1_000_000 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(ATTACHMENT_ERROR);
  });

  it("rejects an image over 10 MB", () => {
    const result = imageAttachmentSchema.safeParse({
      mimeType: "image/jpeg",
      sizeBytes: 11 * 1024 * 1024,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(ATTACHMENT_ERROR);
  });
});

describe("imageAttachmentsListSchema", () => {
  it("accepts up to 5 images", () => {
    const images = Array.from({ length: 5 }, () => ({ mimeType: "image/jpeg", sizeBytes: 1000 }));
    expect(imageAttachmentsListSchema.safeParse(images).success).toBe(true);
  });

  it("rejects more than 5 images", () => {
    const images = Array.from({ length: 6 }, () => ({ mimeType: "image/jpeg", sizeBytes: 1000 }));
    const result = imageAttachmentsListSchema.safeParse(images);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(MESSAGE_IMAGE_COUNT_ERROR);
  });
});

describe("fileAttachmentSchema", () => {
  it("accepts a valid file", () => {
    expect(
      fileAttachmentSchema.safeParse({ mimeType: "application/pdf", sizeBytes: 1_000_000 }).success,
    ).toBe(true);
  });

  it("rejects a file over 25 MB", () => {
    const result = fileAttachmentSchema.safeParse({
      mimeType: "application/pdf",
      sizeBytes: 26 * 1024 * 1024,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(ATTACHMENT_ERROR);
  });
});

describe("voiceNoteSchema", () => {
  it("accepts a voice note under 3 minutes", () => {
    expect(voiceNoteSchema.safeParse({ durationSeconds: 120 }).success).toBe(true);
  });

  it("rejects a voice note over 3 minutes", () => {
    const result = voiceNoteSchema.safeParse({ durationSeconds: 181 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(ATTACHMENT_ERROR);
  });
});

describe("reactionEmojiSchema", () => {
  it("accepts each of the 12 documented reaction emoji", () => {
    for (const emoji of ["👍", "❤️", "😂", "😮", "😢", "🙏", "👏", "🔥", "💯", "🎉", "🤝", "👀"]) {
      expect(reactionEmojiSchema.safeParse(emoji).success).toBe(true);
    }
  });

  it("rejects an emoji outside the set", () => {
    const result = reactionEmojiSchema.safeParse("🍕");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(REACTION_EMOJI_ERROR);
  });
});

describe("forwardConversationIdsSchema", () => {
  it("accepts up to 3 conversation ids", () => {
    expect(forwardConversationIdsSchema.safeParse(["a", "b", "c"]).success).toBe(true);
  });

  it("rejects more than 3 conversation ids", () => {
    const result = forwardConversationIdsSchema.safeParse(["a", "b", "c", "d"]);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(FORWARD_CONVERSATIONS_ERROR);
  });
});

describe("sendMessageSchema", () => {
  it("accepts a valid message.send payload", () => {
    const result = sendMessageSchema.safeParse({
      conversation_id: "018f-v7",
      client_msg_id: "018f-m1",
      body: "Hey, great to connect!",
      reply_to_id: undefined,
      attachment_media_ids: [],
    });
    expect(result.success).toBe(true);
  });
});
