import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

export interface PresignedPut {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: Date;
}

// PRD §17.7: "S3-compatible object storage." A real S3/R2 implementation
// swaps in behind this interface without touching any caller — same
// "local provider now, real backend later" precedent as P5.1's
// KeyProvider/LocalFileKeyProvider (KMS).
export interface StorageProvider {
  presignPut(
    key: string,
    contentType: string,
    contentLength: number,
    ttlSeconds: number,
  ): Promise<PresignedPut>;
  presignGet(key: string, contentType: string, ttlSeconds: number): Promise<string>;
  putObject(key: string, body: Buffer): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
}

export const STORAGE_PROVIDER = "STORAGE_PROVIDER";

interface UploadTokenPayload {
  key: string;
  contentType: string;
  contentLength: number;
  exp: number;
}

interface GetTokenPayload {
  key: string;
  contentType: string;
  exp: number;
}

function sign(secret: string, payload: object): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verify<T>(secret: string, token: string): T | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (signatureBuf.length !== expectedBuf.length || !timingSafeEqual(signatureBuf, expectedBuf))
    return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

// Rejects any key that would escape rootDir via `..` traversal — storage
// keys are server-generated (uuidv7-based), never taken verbatim from a
// client, but this stays defense-in-depth cheap insurance regardless.
function resolveWithinRoot(rootDir: string, key: string): string {
  const resolved = normalize(join(rootDir, key));
  if (!resolved.startsWith(normalize(rootDir))) {
    throw new Error(`StorageProvider: key escapes storage root: ${key}`);
  }
  return resolved;
}

// The local-provider analogue of an S3 presigned URL: a client PUTs bytes
// to `${baseUrl}/media/local-upload/:token`, and this API is itself what
// serves that route (see local-upload.controller.ts) — content-length and
// content-type are bound into the signed token exactly as §17.7 requires
// of the real presigned PUT, and validated against the actual request at
// receive time, not just at issue time.
export class LocalFilesystemStorageProvider implements StorageProvider {
  constructor(
    private readonly rootDir: string,
    private readonly signingSecret: string,
    private readonly baseUrl: string,
  ) {}

  async presignPut(
    key: string,
    contentType: string,
    contentLength: number,
    ttlSeconds: number,
  ): Promise<PresignedPut> {
    const exp = Date.now() + ttlSeconds * 1000;
    const token = sign(this.signingSecret, {
      key,
      contentType,
      contentLength,
      exp,
    } satisfies UploadTokenPayload);
    return {
      url: `${this.baseUrl}/media/local-upload/${token}`,
      method: "PUT",
      headers: { "Content-Type": contentType, "Content-Length": String(contentLength) },
      expiresAt: new Date(exp),
    };
  }

  async presignGet(key: string, contentType: string, ttlSeconds: number): Promise<string> {
    const exp = Date.now() + ttlSeconds * 1000;
    const token = sign(this.signingSecret, { key, contentType, exp } satisfies GetTokenPayload);
    return `${this.baseUrl}/media/local-serve/${token}`;
  }

  verifyUploadToken(
    token: string,
    actualContentType: string,
    actualContentLength: number,
  ): { key: string } | null {
    const payload = verify<UploadTokenPayload>(this.signingSecret, token);
    if (!payload) return null;
    if (Date.now() > payload.exp) return null;
    if (payload.contentType !== actualContentType) return null;
    if (payload.contentLength !== actualContentLength) return null;
    return { key: payload.key };
  }

  verifyGetToken(token: string): { key: string; contentType: string } | null {
    const payload = verify<GetTokenPayload>(this.signingSecret, token);
    if (!payload) return null;
    if (Date.now() > payload.exp) return null;
    return { key: payload.key, contentType: payload.contentType };
  }

  async putObject(key: string, body: Buffer): Promise<void> {
    const path = resolveWithinRoot(this.rootDir, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async getObject(key: string): Promise<Buffer> {
    return readFile(resolveWithinRoot(this.rootDir, key));
  }

  async deleteObject(key: string): Promise<void> {
    await rm(resolveWithinRoot(this.rootDir, key), { force: true });
  }
}
