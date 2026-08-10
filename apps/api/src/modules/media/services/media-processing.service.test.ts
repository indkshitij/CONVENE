import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { MediaProcessingService } from "./media-processing.service";
import type { MediaRepository } from "../repositories/media.repository";
import type { StorageProvider } from "./storage-provider";
import type { RealtimePublisherService } from "../../realtime/realtime-publisher.service";
import type { AvScanner } from "./av-scanner";
import type { Media } from "@convene/db";

async function jpegWithGpsExif(): Promise<Buffer> {
  // See image-processing.test.ts's own comment: sharp's TS types don't
  // declare the GPS IFD even though the runtime accepts it.
  const metadata = {
    exif: { GPS: { GPSLatitude: "1/1 1/1 1/1", GPSLatitudeRef: "N" } },
  } as unknown as import("sharp").WriteableMetadata;
  return sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 100, g: 150, b: 200 } },
  })
    .withMetadata(metadata)
    .jpeg()
    .toBuffer();
}

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
    committedAt: new Date("2026-08-08T10:00:00Z"),
    createdAt: new Date("2026-08-08T09:59:00Z"),
    conversationId: null,
    ...overrides,
  } as Media;
}

function fakeRepo(
  overrides: Partial<Record<keyof MediaRepository, unknown>> = {},
): MediaRepository {
  return {
    findById: vi.fn(async () => fakeMediaRow()),
    updateProcessingResult: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as MediaRepository;
}

function fakeStorage(
  original: Buffer,
  overrides: Partial<Record<keyof StorageProvider, unknown>> = {},
): StorageProvider {
  const written = new Map<string, Buffer>();
  return {
    getObject: vi.fn(async () => original),
    putObject: vi.fn(async (key: string, body: Buffer) => {
      written.set(key, body);
    }),
    presignPut: vi.fn(),
    presignGet: vi.fn(),
    deleteObject: vi.fn(),
    __written: written,
    ...overrides,
  } as unknown as StorageProvider;
}

function fakePublisher(): RealtimePublisherService {
  return { publish: vi.fn(async () => 1) } as unknown as RealtimePublisherService;
}

describe("MediaProcessingService.process", () => {
  it("strips EXIF/GPS, generates avatar derivatives, computes a perceptual hash, and marks clean", async () => {
    const original = await jpegWithGpsExif();
    const repo = fakeRepo();
    const storage = fakeStorage(original);
    const publisher = fakePublisher();
    const service = new MediaProcessingService(repo, storage, publisher);

    await service.process("media-1");

    expect(storage.putObject).toHaveBeenCalledTimes(6); // 3 sizes x 2 formats
    const putObjectMock = storage.putObject as unknown as { mock: { calls: [string, Buffer][] } };
    const [firstCall] = putObjectMock.mock.calls;
    const meta = await sharp(firstCall![1]).metadata();
    expect(meta.exif).toBeUndefined();

    expect(repo.updateProcessingResult).toHaveBeenCalledWith(
      "media-1",
      expect.objectContaining({
        moderationState: "clean",
        avScanState: "clean",
        perceptualHash: expect.stringMatching(/^[0-9a-f]{16}$/),
      }),
    );
    expect(publisher.publish).toHaveBeenCalledWith(
      "rt:user:user-1",
      "media.ready",
      expect.objectContaining({ media_id: "media-1", state: "clean" }),
    );
  });

  it("rejects on magic-byte mismatch and never generates derivatives", async () => {
    const pngBytes = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();
    const repo = fakeRepo({
      findById: vi.fn(async () => fakeMediaRow({ mimeType: "image/jpeg" })),
    }); // declared jpeg, actually a PNG
    const storage = fakeStorage(pngBytes);
    const service = new MediaProcessingService(repo, storage, fakePublisher());

    await service.process("media-1");

    expect(storage.putObject).not.toHaveBeenCalled();
    expect(repo.updateProcessingResult).toHaveBeenCalledWith("media-1", {
      moderationState: "rejected",
      avScanState: "skipped",
    });
  });

  it("refuses an SVG outright, even if declared as an accepted image MIME type", async () => {
    const svgBytes = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const repo = fakeRepo({ findById: vi.fn(async () => fakeMediaRow({ mimeType: "image/png" })) });
    const storage = fakeStorage(svgBytes);
    const service = new MediaProcessingService(repo, storage, fakePublisher());

    await service.process("media-1");

    expect(storage.putObject).not.toHaveBeenCalled();
    expect(repo.updateProcessingResult).toHaveBeenCalledWith("media-1", {
      moderationState: "rejected",
      avScanState: "skipped",
    });
  });

  it("quarantines an infected file without generating derivatives", async () => {
    const original = await jpegWithGpsExif();
    const repo = fakeRepo();
    const storage = fakeStorage(original);
    const infectedScanner: AvScanner = { scan: vi.fn(async () => "infected" as const) };
    const service = new MediaProcessingService(repo, storage, fakePublisher(), infectedScanner);

    await service.process("media-1");

    expect(storage.putObject).not.toHaveBeenCalled();
    expect(repo.updateProcessingResult).toHaveBeenCalledWith("media-1", {
      moderationState: "quarantined",
      avScanState: "infected",
    });
  });

  it("does nothing for a media row that was never committed (e.g. already GC'd)", async () => {
    const repo = fakeRepo({ findById: vi.fn(async () => fakeMediaRow({ committedAt: null })) });
    const storage = fakeStorage(Buffer.from("irrelevant"));
    const service = new MediaProcessingService(repo, storage, fakePublisher());

    await service.process("media-1");

    expect(storage.getObject).not.toHaveBeenCalled();
    expect(repo.updateProcessingResult).not.toHaveBeenCalled();
  });

  it("processes non-image kinds (e.g. resume) without the image pipeline", async () => {
    const repo = fakeRepo({
      findById: vi.fn(async () => fakeMediaRow({ kind: "resume", mimeType: "application/pdf" })),
    });
    const storage = fakeStorage(Buffer.from("%PDF-1.4\ncontent"));
    const service = new MediaProcessingService(repo, storage, fakePublisher());

    await service.process("media-1");

    expect(storage.putObject).not.toHaveBeenCalled();
    expect(repo.updateProcessingResult).toHaveBeenCalledWith("media-1", {
      moderationState: "clean",
      avScanState: "clean",
      derivatives: {},
    });
  });
});
