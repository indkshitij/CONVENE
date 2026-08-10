// §17.7 hard rule: "the declared MIME must match the magic bytes or the
// upload is rejected." No `file-type` package is installed in this repo
// (checked before writing this) — a focused, hand-rolled sniffer over
// exactly the MIME types media.ts's allowlists actually accept is more
// auditable than pulling in a general-purpose dependency for a handful
// of signatures.

function startsWith(buffer: Buffer, bytes: readonly number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, i) => buffer[offset + i] === byte);
}

function asciiAt(buffer: Buffer, text: string, offset: number): boolean {
  if (buffer.length < offset + text.length) return false;
  return buffer.toString("ascii", offset, offset + text.length) === text;
}

// §17.7: "SVG uploads are refused outright (XSS vector)." Checked
// independently of the declared MIME — a client could declare
// image/svg+xml (already excluded from every allowlist in media.ts) or
// could lie and declare image/png; either way this catches the bytes
// themselves. SVG is XML/text, not magic-byte-identifiable the way
// binary formats are, so this sniffs for the telltale opening tags
// instead, over just the first kilobyte (SVGs are never preceded by a
// large binary preamble).
export function looksLikeSvg(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 1024).toString("utf8").trimStart().toLowerCase();
  return head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"));
}

function sniffImageMimeType(buffer: Buffer): string | null {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (asciiAt(buffer, "RIFF", 0) && asciiAt(buffer, "WEBP", 8)) return "image/webp";
  if (asciiAt(buffer, "GIF87a", 0) || asciiAt(buffer, "GIF89a", 0)) return "image/gif";
  if (asciiAt(buffer, "ftyp", 4)) {
    const brand = buffer.toString("ascii", 8, 12);
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  return null;
}

function sniffAudioMimeType(buffer: Buffer): string | null {
  if (asciiAt(buffer, "OggS", 0)) return "audio/ogg";
  if (asciiAt(buffer, "ftyp", 4)) return "audio/mp4"; // m4a shares the ISO-BMFF container with HEIC/MP4.
  if (
    startsWith(buffer, [0xff, 0xfb]) ||
    startsWith(buffer, [0xff, 0xf3]) ||
    asciiAt(buffer, "ID3", 0)
  )
    return "audio/mpeg";
  if (asciiAt(buffer, "RIFF", 0) && asciiAt(buffer, "WEBM", 8)) return "audio/webm";
  return null;
}

function sniffDocumentMimeType(buffer: Buffer): string | null {
  if (asciiAt(buffer, "%PDF", 0)) return "application/pdf";
  // docx/pptx/xlsx/zip all share the ZIP container signature — the sniffer
  // can prove "this is a zip-family container," not distinguish the
  // specific Office format from the bytes alone (that requires unzipping
  // and reading [Content_Types].xml). Treating any of the four declared
  // MIME types as satisfied by a plain ZIP signature is a documented
  // looseness, not a full content-type proof.
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buffer, [0x50, 0x4b, 0x05, 0x06]))
    return "zip-family";
  return null;
}

const ZIP_FAMILY_MIME_TYPES = new Set([
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

// No reliable magic bytes exist for these — they're accepted on faith
// (the same posture as `file-type` itself, which also can't sniff plain
// text). Flagged explicitly rather than silently treated as "verified."
const UNVERIFIABLE_MIME_TYPES = new Set(["text/plain", "text/csv"]);

export function magicBytesMatchDeclaredMime(buffer: Buffer, declaredMimeType: string): boolean {
  if (UNVERIFIABLE_MIME_TYPES.has(declaredMimeType)) return true;

  const imageMatch = sniffImageMimeType(buffer);
  if (imageMatch) return imageMatch === declaredMimeType;

  const audioMatch = sniffAudioMimeType(buffer);
  if (audioMatch) return audioMatch === declaredMimeType;

  const docMatch = sniffDocumentMimeType(buffer);
  if (docMatch === "application/pdf") return declaredMimeType === "application/pdf";
  if (docMatch === "zip-family") return ZIP_FAMILY_MIME_TYPES.has(declaredMimeType);

  return false; // Unrecognised bytes — fail closed.
}
