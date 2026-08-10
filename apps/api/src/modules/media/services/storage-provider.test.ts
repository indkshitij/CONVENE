import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalFilesystemStorageProvider } from "./storage-provider";

describe("LocalFilesystemStorageProvider (real filesystem)", () => {
  let rootDir: string;
  let provider: LocalFilesystemStorageProvider;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "media-storage-test-"));
    provider = new LocalFilesystemStorageProvider(
      rootDir,
      "test-signing-secret-at-least-32-chars-long",
      "http://localhost:8080",
    );
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("round-trips putObject/getObject", async () => {
    await provider.putObject("avatar/abc", Buffer.from("hello world"));
    const read = await provider.getObject("avatar/abc");
    expect(read.toString()).toBe("hello world");
  });

  it("deleteObject removes the file, and is a no-op if it's already gone", async () => {
    await provider.putObject("avatar/def", Buffer.from("bye"));
    await provider.deleteObject("avatar/def");
    await expect(provider.getObject("avatar/def")).rejects.toThrow();
    await expect(provider.deleteObject("avatar/def")).resolves.toBeUndefined();
  });

  describe("presignPut / verifyUploadToken — §17.7: content-length and content-type bound, 15min expiry", () => {
    it("verifies a token whose content-type and content-length match exactly", async () => {
      const presigned = await provider.presignPut("avatar/key1", "image/jpeg", 5000, 900);
      const verified = provider.verifyUploadToken(tokenFromUrl(presigned.url), "image/jpeg", 5000);
      expect(verified).toEqual({ key: "avatar/key1" });
    });

    it("rejects when the actual content-type doesn't match what was presigned", async () => {
      const presigned = await provider.presignPut("avatar/key2", "image/jpeg", 5000, 900);
      expect(provider.verifyUploadToken(tokenFromUrl(presigned.url), "image/png", 5000)).toBeNull();
    });

    it("rejects when the actual content-length doesn't match what was presigned", async () => {
      const presigned = await provider.presignPut("avatar/key3", "image/jpeg", 5000, 900);
      expect(
        provider.verifyUploadToken(tokenFromUrl(presigned.url), "image/jpeg", 4999),
      ).toBeNull();
    });

    it("rejects an expired token", async () => {
      const presigned = await provider.presignPut("avatar/key4", "image/jpeg", 5000, -1); // already expired
      expect(
        provider.verifyUploadToken(tokenFromUrl(presigned.url), "image/jpeg", 5000),
      ).toBeNull();
    });

    it("rejects a tampered token", async () => {
      const presigned = await provider.presignPut("avatar/key5", "image/jpeg", 5000, 900);
      const tampered = tokenFromUrl(presigned.url).slice(0, -1) + "x";
      expect(provider.verifyUploadToken(tampered, "image/jpeg", 5000)).toBeNull();
    });

    it("rejects a token issued for a different key being used to overwrite another object", async () => {
      const presigned = await provider.presignPut("avatar/key6", "image/jpeg", 5000, 900);
      const verified = provider.verifyUploadToken(tokenFromUrl(presigned.url), "image/jpeg", 5000);
      expect(verified?.key).toBe("avatar/key6");
      expect(verified?.key).not.toBe("avatar/some-other-key");
    });
  });

  describe("presignGet / verifyGetToken — §17.7: 10-minute signed serving URLs", () => {
    it("verifies a valid token and carries the content-type through", async () => {
      const url = await provider.presignGet("avatar/key7", "image/webp", 600);
      const verified = provider.verifyGetToken(tokenFromUrl(url));
      expect(verified).toEqual({ key: "avatar/key7", contentType: "image/webp" });
    });

    it("rejects an expired serve token", async () => {
      const url = await provider.presignGet("avatar/key8", "image/webp", -1);
      expect(provider.verifyGetToken(tokenFromUrl(url))).toBeNull();
    });
  });
});

function tokenFromUrl(url: string): string {
  const parts = url.split("/");
  return parts[parts.length - 1] ?? "";
}
