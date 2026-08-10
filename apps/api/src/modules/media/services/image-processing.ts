import sharp from "sharp";

export const AVATAR_SIZES = [128, 256, 512] as const;
export const AVATAR_FORMATS = ["webp", "avif"] as const;
export const IMAGE_SIZES = [320, 720, 1440] as const;

export interface ImageDimensions {
  width: number | null;
  height: number | null;
}

// §17.7 hard rule: "EXIF including GPS is stripped from every image
// before any derivative is stored or served." sharp strips ALL metadata
// (EXIF/GPS/ICC/XMP) by default on encode — the safety property here is
// simply *not* calling `.withMetadata()`, ever, anywhere in this file.
// `.rotate()` with no arguments applies the EXIF orientation tag as a
// real pixel transform *before* that tag is discarded, so images taken
// on a rotated phone don't end up sideways once their orientation
// metadata is gone.
export async function stripExif(original: Buffer): Promise<Buffer> {
  return sharp(original).rotate().toBuffer();
}

export async function readDimensions(strippedImage: Buffer): Promise<ImageDimensions> {
  const metadata = await sharp(strippedImage).metadata();
  return { width: metadata.width ?? null, height: metadata.height ?? null };
}

// §17.7: "derivatives (avatar 128/256/512 WebP+AVIF...)."
export async function generateAvatarDerivatives(
  strippedImage: Buffer,
): Promise<Record<string, Buffer>> {
  const derivatives: Record<string, Buffer> = {};
  for (const size of AVATAR_SIZES) {
    for (const format of AVATAR_FORMATS) {
      const pipeline = sharp(strippedImage).resize(size, size, { fit: "cover" });
      derivatives[`${size}_${format}`] =
        format === "webp" ? await pipeline.webp().toBuffer() : await pipeline.avif().toBuffer();
    }
  }
  return derivatives;
}

// §17.7: "image 320/720/1440." No second format is named for general
// images the way avatars explicitly get "WebP+AVIF" — WebP alone is used
// here (broad support, good compression); flagged as an interpretation,
// not a transcription, since the PRD is silent on format for this row.
export async function generateImageDerivatives(
  strippedImage: Buffer,
): Promise<Record<string, Buffer>> {
  const derivatives: Record<string, Buffer> = {};
  for (const size of IMAGE_SIZES) {
    const buffer = await sharp(strippedImage)
      .resize(size, null, { fit: "inside", withoutEnlargement: true })
      .webp()
      .toBuffer();
    derivatives[`${size}_webp`] = buffer;
  }
  return derivatives;
}

// §17.7: "avatars are perceptual-hashed for the fake-profile ring
// detection in §12.9." A standard average-hash (aHash): downscale to
// 8x8 grayscale, threshold each pixel against the mean, pack the 64
// resulting bits into a hex string. Deliberately computed from the
// EXIF-stripped, rotation-corrected buffer — two visually-identical
// photos (one with EXIF orientation metadata, one without) must hash
// identically for ring detection to work at all.
export async function computeAverageHash(strippedImage: Buffer): Promise<string> {
  const { data } = await sharp(strippedImage)
    .resize(8, 8, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let sum = 0;
  for (const value of data) sum += value;
  const mean = sum / data.length;

  let bits = "";
  for (const value of data) bits += value >= mean ? "1" : "0";

  return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
}
