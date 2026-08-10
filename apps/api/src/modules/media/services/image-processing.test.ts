import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  computeAverageHash,
  generateAvatarDerivatives,
  generateImageDerivatives,
  readDimensions,
  stripExif,
} from "./image-processing";

async function jpegWithGpsExif(): Promise<Buffer> {
  // sharp's own TS types (Exif) only declare IFD0-3, but its runtime
  // metadata writer accepts a raw GPS IFD too (verified directly against
  // the installed sharp binary before writing this) — cast around the
  // type gap rather than the runtime behaviour.
  const metadata = {
    exif: {
      IFD0: { Make: "TestCam" },
      GPS: {
        GPSLatitude: "37/1 46/1 30/1",
        GPSLatitudeRef: "N",
        GPSLongitude: "122/1 25/1 10/1",
        GPSLongitudeRef: "W",
      },
    },
  } as unknown as import("sharp").WriteableMetadata;
  return sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 20, b: 20 } },
  })
    .withMetadata(metadata)
    .jpeg()
    .toBuffer();
}

async function plainImage(color: { r: number; g: number; b: number }, size = 64): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 3, background: color } })
    .png()
    .toBuffer();
}

// A flat, single-colour image has zero internal variation, which is a
// degenerate input for an average-hash (every pixel sits exactly at the
// mean, so the >=-mean threshold collapses to all-1s or all-0s
// regardless of which colour it was) — real photos always have texture.
// This builds two half-and-half images so the hash has something to
// actually distinguish.
async function splitImage(
  topColor: { r: number; g: number; b: number },
  bottomColor: { r: number; g: number; b: number },
  size = 64,
): Promise<Buffer> {
  const top = sharp({
    create: { width: size, height: size / 2, channels: 3, background: topColor },
  });
  const bottom = sharp({
    create: { width: size, height: size / 2, channels: 3, background: bottomColor },
  });
  const [topBuf, bottomBuf] = await Promise.all([top.png().toBuffer(), bottom.png().toBuffer()]);
  return sharp({
    create: { width: size, height: size, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([
      { input: topBuf, top: 0, left: 0 },
      { input: bottomBuf, top: size / 2, left: 0 },
    ])
    .png()
    .toBuffer();
}

// P16.1's acceptance criterion, verified directly against real sharp
// processing (no mocking): "No stored or served artefact retains EXIF
// location data."
describe("stripExif — §17.7 hard rule", () => {
  it("removes EXIF (including GPS) from a JPEG that has it", async () => {
    const original = await jpegWithGpsExif();
    const originalMeta = await sharp(original).metadata();
    expect(originalMeta.exif).toBeDefined(); // Sanity: the fixture really does carry EXIF.

    const stripped = await stripExif(original);
    const strippedMeta = await sharp(stripped).metadata();
    expect(strippedMeta.exif).toBeUndefined();
  });

  it("every avatar derivative generated from a stripped image is itself EXIF-free", async () => {
    const original = await jpegWithGpsExif();
    const stripped = await stripExif(original);
    const derivatives = await generateAvatarDerivatives(stripped);

    expect(Object.keys(derivatives)).toHaveLength(6); // 3 sizes x 2 formats
    for (const [name, buffer] of Object.entries(derivatives)) {
      const meta = await sharp(buffer).metadata();
      expect(meta.exif, `derivative ${name} must not carry EXIF`).toBeUndefined();
    }
  });

  it("every message_image derivative generated from a stripped image is itself EXIF-free", async () => {
    const original = await jpegWithGpsExif();
    const stripped = await stripExif(original);
    const derivatives = await generateImageDerivatives(stripped);

    expect(Object.keys(derivatives)).toHaveLength(3);
    for (const [name, buffer] of Object.entries(derivatives)) {
      const meta = await sharp(buffer).metadata();
      expect(meta.exif, `derivative ${name} must not carry EXIF`).toBeUndefined();
    }
  });
});

describe("generateAvatarDerivatives", () => {
  it("produces 128/256/512 in both webp and avif, each exactly the requested size", async () => {
    const stripped = await stripExif(await plainImage({ r: 10, g: 200, b: 10 }, 600));
    const derivatives = await generateAvatarDerivatives(stripped);

    // libvips reports an AVIF-encoded buffer's format as "heif" (AVIF is
    // an HEIF-family container) — a metadata-reporting quirk, not a sign
    // the wrong codec ran.
    const expectedFormat = { webp: "webp", avif: "heif" } as const;
    for (const size of [128, 256, 512] as const) {
      for (const format of ["webp", "avif"] as const) {
        const buffer = derivatives[`${size}_${format}`];
        expect(buffer).toBeDefined();
        const meta = await sharp(buffer!).metadata();
        expect(meta.width).toBe(size);
        expect(meta.height).toBe(size);
        expect(meta.format).toBe(expectedFormat[format]);
      }
    }
  });
});

describe("generateImageDerivatives", () => {
  it("produces 320/720/1440 webp derivatives, capped by the source size (withoutEnlargement)", async () => {
    const stripped = await stripExif(await plainImage({ r: 10, g: 10, b: 200 }, 2000));
    const derivatives = await generateImageDerivatives(stripped);

    for (const size of [320, 720, 1440] as const) {
      const buffer = derivatives[`${size}_webp`];
      const meta = await sharp(buffer!).metadata();
      expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(size);
      expect(meta.format).toBe("webp");
    }
  });
});

describe("computeAverageHash — §12.9 perceptual hashing for avatars", () => {
  it("returns a 16-character hex string", async () => {
    const stripped = await stripExif(await plainImage({ r: 128, g: 128, b: 128 }));
    const hash = await computeAverageHash(stripped);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is stable for the same image", async () => {
    const stripped = await stripExif(await plainImage({ r: 40, g: 90, b: 160 }));
    const hashA = await computeAverageHash(stripped);
    const hashB = await computeAverageHash(stripped);
    expect(hashA).toBe(hashB);
  });

  it("differs for visibly different images", async () => {
    const strippedA = await stripExif(
      await splitImage({ r: 250, g: 250, b: 250 }, { r: 5, g: 5, b: 5 }),
    );
    const strippedB = await stripExif(
      await splitImage({ r: 5, g: 5, b: 5 }, { r: 250, g: 250, b: 250 }),
    );
    const hashA = await computeAverageHash(strippedA);
    const hashB = await computeAverageHash(strippedB);
    expect(hashA).not.toBe(hashB);
  });
});

describe("readDimensions", () => {
  it("reads width/height from a processed image", async () => {
    const stripped = await stripExif(await plainImage({ r: 1, g: 2, b: 3 }, 300));
    const dimensions = await readDimensions(stripped);
    expect(dimensions).toEqual({ width: 300, height: 300 });
  });
});
