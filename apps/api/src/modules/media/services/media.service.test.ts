import { describe, expect, it, vi } from "vitest";
import { MediaService } from "./media.service";
import type { MediaRepository } from "../repositories/media.repository";
import type { MediaProcessingProducer } from "./media-processing.producer";
import type { MessagesRepository } from "../../messaging/repositories/messages.repository";
import type { StorageProvider } from "./storage-provider";
import type { Media } from "@convene/db";

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
    committedAt: null,
    createdAt: new Date("2026-08-08T09:59:00Z"),
    conversationId: null,
    ...overrides,
  } as Media;
}

function fakeRepo(
  overrides: Partial<Record<keyof MediaRepository, unknown>> = {},
): MediaRepository {
  return {
    create: vi.fn(async () => fakeMediaRow()),
    findById: vi.fn(async () => fakeMediaRow()),
    markCommitted: vi.fn(async () => fakeMediaRow({ committedAt: new Date() })),
    findUncommittedOlderThan: vi.fn(async () => []),
    deleteById: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as MediaRepository;
}

function fakeStorage(
  overrides: Partial<Record<keyof StorageProvider, unknown>> = {},
): StorageProvider {
  return {
    presignPut: vi.fn(async () => ({
      url: "http://local/media/local-upload/token",
      method: "PUT" as const,
      headers: { "Content-Type": "image/jpeg" },
      expiresAt: new Date("2026-08-08T10:15:00Z"),
    })),
    presignGet: vi.fn(async () => "http://local/media/local-serve/token"),
    putObject: vi.fn(),
    getObject: vi.fn(),
    deleteObject: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as StorageProvider;
}

function fakeProducer(): MediaProcessingProducer {
  return { enqueueProcess: vi.fn(async () => undefined) } as unknown as MediaProcessingProducer;
}

function fakeMessagesRepo(
  overrides: Partial<Record<keyof MessagesRepository, unknown>> = {},
): MessagesRepository {
  return {
    loadParticipantIds: vi.fn(async () => ["user-1", "user-2"]),
    ...overrides,
  } as unknown as MessagesRepository;
}

describe("MediaService.createUploadIntent", () => {
  it("creates a media row and returns a presigned PUT", async () => {
    const repo = fakeRepo();
    const storage = fakeStorage();
    const service = new MediaService(repo, storage, fakeProducer(), fakeMessagesRepo());

    const result = await service.createUploadIntent("user-1", {
      kind: "avatar",
      mimeType: "image/jpeg",
      sizeBytes: 5000,
    });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "user-1",
        kind: "avatar",
        mimeType: "image/jpeg",
        sizeBytes: 5000,
      }),
    );
    expect(storage.presignPut).toHaveBeenCalledWith(
      expect.stringContaining("avatar/"),
      "image/jpeg",
      5000,
      15 * 60,
    );
    expect(result.mediaId).toBe("media-1");
    expect(result.method).toBe("PUT");
  });
});

describe("MediaService.commit", () => {
  it("marks committed and enqueues processing", async () => {
    const repo = fakeRepo();
    const producer = fakeProducer();
    const service = new MediaService(repo, fakeStorage(), producer, fakeMessagesRepo());

    await service.commit("media-1", "user-1", null);

    expect(repo.markCommitted).toHaveBeenCalledWith("media-1", expect.any(Date), null);
    expect(producer.enqueueProcess).toHaveBeenCalledWith({ mediaId: "media-1" });
  });

  it("404s when the media doesn't exist", async () => {
    const repo = fakeRepo({ findById: vi.fn(async () => null) });
    const service = new MediaService(repo, fakeStorage(), fakeProducer(), fakeMessagesRepo());
    await expect(service.commit("missing", "user-1", null)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("forbids committing someone else's upload", async () => {
    const repo = fakeRepo({
      findById: vi.fn(async () => fakeMediaRow({ ownerId: "someone-else" })),
    });
    const service = new MediaService(repo, fakeStorage(), fakeProducer(), fakeMessagesRepo());
    await expect(service.commit("media-1", "user-1", null)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("409s on a duplicate commit", async () => {
    const repo = fakeRepo({ markCommitted: vi.fn(async () => null) });
    const service = new MediaService(repo, fakeStorage(), fakeProducer(), fakeMessagesRepo());
    await expect(service.commit("media-1", "user-1", null)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("MediaService.getSignedUrl — §17.7 participant check", () => {
  it("allows the owner", async () => {
    const repo = fakeRepo({ findById: vi.fn(async () => fakeMediaRow({ ownerId: "user-1" })) });
    const service = new MediaService(repo, fakeStorage(), fakeProducer(), fakeMessagesRepo());
    const result = await service.getSignedUrl("media-1", "user-1");
    expect(result.url).toContain("local-serve");
  });

  it("allows a conversation participant for a message-attachment kind", async () => {
    const repo = fakeRepo({
      findById: vi.fn(async () =>
        fakeMediaRow({
          ownerId: "user-1",
          kind: "message_image",
          conversationId: "conversation-1",
        }),
      ),
    });
    const messagesRepo = fakeMessagesRepo({
      loadParticipantIds: vi.fn(async () => ["user-1", "user-2"]),
    });
    const service = new MediaService(repo, fakeStorage(), fakeProducer(), messagesRepo);
    await expect(service.getSignedUrl("media-1", "user-2")).resolves.toBeDefined();
  });

  it("404s (not 403) a non-participant, non-owner — this phase's own explicit testing criterion", async () => {
    const repo = fakeRepo({
      findById: vi.fn(async () =>
        fakeMediaRow({
          ownerId: "user-1",
          kind: "message_image",
          conversationId: "conversation-1",
        }),
      ),
    });
    const messagesRepo = fakeMessagesRepo({
      loadParticipantIds: vi.fn(async () => ["user-1", "user-2"]),
    });
    const service = new MediaService(repo, fakeStorage(), fakeProducer(), messagesRepo);
    await expect(service.getSignedUrl("media-1", "user-99")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("404s a non-owner when the media has no conversation link at all (e.g. an avatar)", async () => {
    const repo = fakeRepo({
      findById: vi.fn(async () =>
        fakeMediaRow({ ownerId: "user-1", kind: "avatar", conversationId: null }),
      ),
    });
    const service = new MediaService(repo, fakeStorage(), fakeProducer(), fakeMessagesRepo());
    await expect(service.getSignedUrl("media-1", "user-2")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("404s when the media doesn't exist at all", async () => {
    const repo = fakeRepo({ findById: vi.fn(async () => null) });
    const service = new MediaService(repo, fakeStorage(), fakeProducer(), fakeMessagesRepo());
    await expect(service.getSignedUrl("missing", "user-1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("MediaService.gcUncommitted — §17.7: uncommitted rows GC'd after 24h", () => {
  it("deletes the underlying object and the row for every stale uncommitted upload", async () => {
    const stale = [fakeMediaRow({ id: "stale-1" }), fakeMediaRow({ id: "stale-2" })];
    const repo = fakeRepo({ findUncommittedOlderThan: vi.fn(async () => stale) });
    const storage = fakeStorage();
    const service = new MediaService(repo, storage, fakeProducer(), fakeMessagesRepo());

    const count = await service.gcUncommitted();

    expect(count).toBe(2);
    expect(storage.deleteObject).toHaveBeenCalledTimes(2);
    expect(repo.deleteById).toHaveBeenCalledWith("stale-1");
    expect(repo.deleteById).toHaveBeenCalledWith("stale-2");
  });

  it("does nothing when there's nothing stale", async () => {
    const repo = fakeRepo();
    const service = new MediaService(repo, fakeStorage(), fakeProducer(), fakeMessagesRepo());
    expect(await service.gcUncommitted()).toBe(0);
  });
});
