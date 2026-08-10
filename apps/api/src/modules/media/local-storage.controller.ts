import { Controller, Get, Inject, Param, Put, Req, Res } from "@nestjs/common";
import { Public } from "../../common/auth/jwt.guard";
import { BadRequestAppError, GoneAppError } from "../../common/errors/app-error";
import { LocalFilesystemStorageProvider, STORAGE_PROVIDER } from "./services/storage-provider";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // Matches media.ts's largest per-kind ceiling ('export').

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  on(event: "data", listener: (chunk: Buffer) => void): void;
  on(event: "end", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  destroy(): void;
}

interface ResponseLike {
  status(code: number): ResponseLike;
  setHeader(name: string, value: string): void;
  end(): void;
  send(body: Buffer): void;
}

// The local-provider stand-in for S3's own presigned-URL endpoints — see
// storage-provider.ts's own comment. Public routes: the HMAC-signed token
// itself is the authorization (exactly what a presigned URL's query-string
// signature is for a real S3 bucket), not a bearer token. Only meaningful
// when STORAGE_PROVIDER resolves to LocalFilesystemStorageProvider; a real
// S3 deployment wouldn't register this controller's routes at all (the
// client PUTs/GETs S3 directly), but leaving it registered is harmless —
// it simply never gets a validly-signed token if nothing issues one.
@Controller("media")
export class LocalStorageController {
  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: LocalFilesystemStorageProvider) {}

  @Put("local-upload/:token")
  @Public()
  async upload(
    @Req() request: RequestLike,
    @Param("token") token: string,
    @Res() response: ResponseLike,
  ): Promise<void> {
    const contentType = firstHeaderValue(request.headers["content-type"]) ?? "";
    const contentLength = Number(firstHeaderValue(request.headers["content-length"]) ?? "0");

    const verified = this.storage.verifyUploadToken(token, contentType, contentLength);
    if (!verified) {
      throw new GoneAppError("GONE", "This upload URL has expired or is invalid.");
    }
    if (contentLength <= 0 || contentLength > MAX_UPLOAD_BYTES) {
      throw new BadRequestAppError("BAD_REQUEST", "Invalid content length.");
    }

    const body = await readBodyExactly(request, contentLength);
    await this.storage.putObject(verified.key, body);
    response.status(200).end();
  }

  @Get("local-serve/:token")
  @Public()
  async serve(@Param("token") token: string, @Res() response: ResponseLike): Promise<void> {
    const verified = this.storage.verifyGetToken(token);
    if (!verified) {
      throw new GoneAppError("GONE", "This media URL has expired or is invalid.");
    }
    const body = await this.storage.getObject(verified.key);
    response.setHeader("Content-Type", verified.contentType);
    response.setHeader("Cache-Control", "private, max-age=0, no-store");
    response.status(200).send(body);
  }
}

// Express's own body-parser middleware only intercepts content-types it
// recognises (application/json, urlencoded) and calls next() untouched
// for anything else — an image/octet PUT's stream is still fully
// available here. Buffers to memory (bounded by MAX_UPLOAD_BYTES above)
// rather than streaming to disk directly, since putObject() already
// takes a Buffer and every upload kind is well under 100MB.
function readBodyExactly(request: RequestLike, expectedLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    request.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > expectedLength) {
        reject(
          new BadRequestAppError("BAD_REQUEST", "Uploaded body exceeds declared Content-Length."),
        );
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
