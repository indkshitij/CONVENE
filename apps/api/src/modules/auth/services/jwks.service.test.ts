import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JwksService, LocalFileKeyProvider } from "./jwks.service";

describe("LocalFileKeyProvider / JwksService", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "convene-jwks-test-"));
    filePath = join(dir, "keys.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("bootstraps a key on first use when no store file exists yet", async () => {
    const provider = new LocalFileKeyProvider(filePath);
    const key = await provider.getCurrentKey();
    expect(key.kid).toBeTruthy();
    expect(key.privateKeyPem).toContain("PRIVATE KEY");
    expect(key.publicKeyPem).toContain("PUBLIC KEY");
  });

  it("returns the same current key across calls without rotating again", async () => {
    const provider = new LocalFileKeyProvider(filePath);
    const first = await provider.getCurrentKey();
    const second = await provider.getCurrentKey();
    expect(second.kid).toBe(first.kid);
  });

  it("retains both current and previous keys after one rotation", async () => {
    const provider = new LocalFileKeyProvider(filePath);
    const original = await provider.getCurrentKey();
    const rotated = await provider.rotate();

    const keys = await provider.getPublicKeys();
    expect(keys).toHaveLength(2);
    expect(keys.map((k) => k.kid)).toEqual([rotated.kid, original.kid]);
  });

  it("drops the oldest key once more than 2 rotations have happened", async () => {
    const provider = new LocalFileKeyProvider(filePath);
    await provider.getCurrentKey();
    const second = await provider.rotate();
    const third = await provider.rotate();

    const keys = await provider.getPublicKeys();
    expect(keys).toHaveLength(2);
    expect(keys.map((k) => k.kid)).toEqual([third.kid, second.kid]);
  });

  describe("JwksService", () => {
    it("exposes the current key as the signing key", async () => {
      const provider = new LocalFileKeyProvider(filePath);
      const service = new JwksService(provider);
      const current = await provider.getCurrentKey();
      const signingKey = await service.getSigningKey();
      expect(signingKey.kid).toBe(current.kid);
    });

    it("exposes both keys as verification keys after a rotation", async () => {
      const provider = new LocalFileKeyProvider(filePath);
      const service = new JwksService(provider);
      const original = await provider.getCurrentKey();
      await service.rotate();

      const verificationKeys = await service.getVerificationKeys();
      expect(verificationKeys).toHaveLength(2);
      expect(verificationKeys.some((k) => k.kid === original.kid)).toBe(true);
    });

    it("produces valid JWK entries for /.well-known/jwks.json", async () => {
      const provider = new LocalFileKeyProvider(filePath);
      const service = new JwksService(provider);
      await provider.getCurrentKey();

      const jwks = await service.getJwks();
      expect(jwks.keys).toHaveLength(1);
      const [jwk] = jwks.keys;
      expect(jwk?.kty).toBe("RSA");
      expect(jwk?.alg).toBe("RS256");
      expect(jwk?.use).toBe("sig");
      expect(typeof jwk?.n).toBe("string");
      expect(typeof jwk?.e).toBe("string");
      expect(jwk?.kid).toBeTruthy();
    });
  });
});
