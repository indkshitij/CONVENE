import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { looksLikeSvg, magicBytesMatchDeclaredMime } from "./magic-bytes";

describe("magicBytesMatchDeclaredMime", () => {
  it("accepts a real JPEG declared as image/jpeg", async () => {
    const buffer = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .toBuffer();
    expect(magicBytesMatchDeclaredMime(buffer, "image/jpeg")).toBe(true);
  });

  it("rejects a PNG renamed/declared as image/jpeg — P16.1's own acceptance test", async () => {
    const pngBuffer = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();
    expect(magicBytesMatchDeclaredMime(pngBuffer, "image/jpeg")).toBe(false);
    // The true content type is still correctly identified — this isn't a
    // "can't sniff PNGs" failure, it's a declared-vs-actual mismatch.
    expect(magicBytesMatchDeclaredMime(pngBuffer, "image/png")).toBe(true);
  });

  it("accepts a real WebP declared as image/webp", async () => {
    const buffer = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .webp()
      .toBuffer();
    expect(magicBytesMatchDeclaredMime(buffer, "image/webp")).toBe(true);
    expect(magicBytesMatchDeclaredMime(buffer, "image/png")).toBe(false);
  });

  it("accepts a real PDF declared as application/pdf", () => {
    const buffer = Buffer.from("%PDF-1.4\n%some pdf content");
    expect(magicBytesMatchDeclaredMime(buffer, "application/pdf")).toBe(true);
    expect(magicBytesMatchDeclaredMime(buffer, "image/jpeg")).toBe(false);
  });

  it("accepts a zip-family container declared as any of the four zip-based MIME types", () => {
    const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(magicBytesMatchDeclaredMime(buffer, "application/zip")).toBe(true);
    expect(
      magicBytesMatchDeclaredMime(
        buffer,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
  });

  it("fails closed on unrecognised bytes", () => {
    const buffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    expect(magicBytesMatchDeclaredMime(buffer, "image/jpeg")).toBe(false);
  });

  it("does not attempt to verify text/plain or text/csv (no reliable magic bytes)", () => {
    const buffer = Buffer.from("just, some, csv, text\n1,2,3");
    expect(magicBytesMatchDeclaredMime(buffer, "text/csv")).toBe(true);
    expect(magicBytesMatchDeclaredMime(buffer, "text/plain")).toBe(true);
  });
});

describe("looksLikeSvg — §17.7: SVG uploads refused outright", () => {
  it("flags a plain <svg> document", () => {
    expect(
      looksLikeSvg(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      ),
    ).toBe(true);
  });

  it("flags an XML-prefixed SVG document", () => {
    expect(
      looksLikeSvg(
        Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      ),
    ).toBe(true);
  });

  it("does not flag a real JPEG", async () => {
    const buffer = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .toBuffer();
    expect(looksLikeSvg(buffer)).toBe(false);
  });

  it("does not flag unrelated XML", () => {
    expect(looksLikeSvg(Buffer.from('<?xml version="1.0"?><root><item/></root>'))).toBe(false);
  });
});
