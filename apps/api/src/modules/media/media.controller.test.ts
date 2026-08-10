import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../../common/auth/auth-context";
import { MediaController } from "./media.controller";
import type { MediaService } from "./services/media.service";
import type { Media } from "@convene/db";

const authContext: AuthContext = {
  id: "user-1",
  role: "user",
  plan: "free",
  status: "active",
  tokenVersion: 0,
  shadowLimited: false,
};

function fakeMediaRow(overrides: Partial<Media> = {}): Media {
  return {
    id: "media-1",
    ownerId: "user-1",
    kind: "avatar",
    storageKey: "avatar/media-1",
    mimeType: "image/jpeg",
    sizeBytes: 1000,
    width: null,
    height: null,
    durationMs: null,
    derivatives: {},
    perceptualHash: null,
    moderationState: "pending",
    avScanState: "pending",
    committedAt: new Date(),
    createdAt: new Date(),
    conversationId: null,
    ...overrides,
  } as Media;
}

function fakeService(overrides: Partial<Record<keyof MediaService, unknown>> = {}): MediaService {
  return {
    createUploadIntent: vi.fn(async () => ({
      mediaId: "media-1",
      uploadUrl: "http://local/upload/token",
      method: "PUT" as const,
      headers: { "Content-Type": "image/jpeg" },
      expiresAt: "2026-08-08T10:15:00.000Z",
    })),
    commit: vi.fn(async () => fakeMediaRow()),
    getSignedUrl: vi.fn(async () => ({
      url: "http://local/serve/token",
      expiresAt: "2026-08-08T10:10:00.000Z",
    })),
    ...overrides,
  } as unknown as MediaService;
}

describe("MediaController", () => {
  describe("POST /media/upload-intent", () => {
    it("delegates and maps to snake_case", async () => {
      const service = fakeService();
      const controller = new MediaController(service);
      const result = await controller.createUploadIntent(
        { authContext },
        { kind: "avatar", mime_type: "image/jpeg", size_bytes: 5000 },
      );
      expect(service.createUploadIntent).toHaveBeenCalledWith("user-1", {
        kind: "avatar",
        mimeType: "image/jpeg",
        sizeBytes: 5000,
      });
      expect(result.media_id).toBe("media-1");
      expect(result.upload_url).toContain("upload/token");
    });

    it("rejects when no auth context is present", async () => {
      const controller = new MediaController(fakeService());
      await expect(
        controller.createUploadIntent(
          {},
          { kind: "avatar", mime_type: "image/jpeg", size_bytes: 5000 },
        ),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("POST /media/:id/commit", () => {
    it("delegates and returns state: processing", async () => {
      const service = fakeService();
      const controller = new MediaController(service);
      const result = await controller.commit({ authContext }, "media-1", {
        conversation_id: "conversation-1",
      });
      expect(service.commit).toHaveBeenCalledWith("media-1", "user-1", "conversation-1");
      expect(result).toEqual({ media_id: "media-1", state: "processing" });
    });
  });

  describe("GET /media/:id/url", () => {
    it("delegates to getSignedUrl", async () => {
      const service = fakeService();
      const controller = new MediaController(service);
      const result = await controller.getSignedUrl({ authContext }, "media-1");
      expect(service.getSignedUrl).toHaveBeenCalledWith("media-1", "user-1");
      expect(result.url).toContain("serve/token");
    });
  });
});
