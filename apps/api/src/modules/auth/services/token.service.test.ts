import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JwksService, LocalFileKeyProvider } from "./jwks.service";
import { TokenService } from "./token.service";

describe("TokenService", () => {
  let dir: string;
  let jwks: JwksService;
  let tokenService: TokenService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "convene-token-test-"));
    const provider = new LocalFileKeyProvider(join(dir, "keys.json"));
    jwks = new JwksService(provider);
    tokenService = new TokenService(jwks);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("access tokens", () => {
    it("signs and verifies round-trip with all documented claims present", async () => {
      const token = await tokenService.signAccessToken({
        sub: "user-1",
        role: "user",
        plan: "free",
        tv: 0,
      });
      const decoded = await tokenService.verifyAccessToken(token);

      expect(decoded.sub).toBe("user-1");
      expect(decoded.role).toBe("user");
      expect(decoded.plan).toBe("free");
      expect(decoded.tv).toBe(0);
      expect(decoded.iss).toBe("https://api.convene.app");
      expect(decoded.aud).toBe("https://api.convene.app");
      expect(typeof decoded.iat).toBe("number");
      expect(typeof decoded.exp).toBe("number");
      expect(typeof decoded.jti).toBe("string");
    });

    it("sets a 15-minute expiry", async () => {
      const token = await tokenService.signAccessToken({
        sub: "user-1",
        role: "user",
        plan: "free",
        tv: 0,
      });
      const decoded = await tokenService.verifyAccessToken(token);
      expect(decoded.exp - decoded.iat).toBe(15 * 60);
    });

    it("gives each signed token a distinct jti", async () => {
      const claims = { sub: "user-1", role: "user", plan: "free", tv: 0 };
      const a = await tokenService.verifyAccessToken(await tokenService.signAccessToken(claims));
      const b = await tokenService.verifyAccessToken(await tokenService.signAccessToken(claims));
      expect(a.jti).not.toBe(b.jti);
    });

    it("rejects a malformed token", async () => {
      await expect(tokenService.verifyAccessToken("not-a-jwt")).rejects.toThrow(/malformed/);
    });

    it("rejects a token whose kid matches no known verification key", async () => {
      const token = await tokenService.signAccessToken({
        sub: "user-1",
        role: "user",
        plan: "free",
        tv: 0,
      });
      const tampered = token.slice(0, -4) + "abcd";
      await expect(tokenService.verifyAccessToken(tampered)).rejects.toThrow();
    });

    // PRD P5.1 acceptance: "Rotating keys does not invalidate outstanding
    // access tokens." §17.4: "both the current and previous public keys
    // published ... so in-flight tokens survive rotation."
    it("still validates a token signed with the previous key after rotation", async () => {
      const tokenBeforeRotation = await tokenService.signAccessToken({
        sub: "user-1",
        role: "user",
        plan: "free",
        tv: 0,
      });

      await jwks.rotate();

      const decoded = await tokenService.verifyAccessToken(tokenBeforeRotation);
      expect(decoded.sub).toBe("user-1");
    });

    it("signs new tokens with the new key after rotation, and both old and new tokens verify", async () => {
      const oldToken = await tokenService.signAccessToken({
        sub: "user-1",
        role: "user",
        plan: "free",
        tv: 0,
      });
      await jwks.rotate();
      const newToken = await tokenService.signAccessToken({
        sub: "user-2",
        role: "user",
        plan: "free",
        tv: 0,
      });

      const oldDecoded = await tokenService.verifyAccessToken(oldToken);
      const newDecoded = await tokenService.verifyAccessToken(newToken);
      expect(oldDecoded.sub).toBe("user-1");
      expect(newDecoded.sub).toBe("user-2");
    });

    it("rejects a token once its signing key has fully rotated out (two rotations later)", async () => {
      const token = await tokenService.signAccessToken({
        sub: "user-1",
        role: "user",
        plan: "free",
        tv: 0,
      });
      await jwks.rotate();
      await jwks.rotate();
      await expect(tokenService.verifyAccessToken(token)).rejects.toThrow(/no verification key/);
    });
  });

  describe("refresh tokens", () => {
    it("generates a token and a matching SHA-256 hash", () => {
      const { token, hash } = tokenService.generateRefreshToken();
      expect(token).toBeTruthy();
      expect(hash).toBe(tokenService.hashRefreshToken(token));
    });

    it("generates a different token on each call", () => {
      const a = tokenService.generateRefreshToken();
      const b = tokenService.generateRefreshToken();
      expect(a.token).not.toBe(b.token);
      expect(a.hash).not.toBe(b.hash);
    });

    it("hashes deterministically — the same token always hashes the same way", () => {
      const { token } = tokenService.generateRefreshToken();
      expect(tokenService.hashRefreshToken(token)).toBe(tokenService.hashRefreshToken(token));
    });

    it("never stores the raw token in the hash", () => {
      const { token, hash } = tokenService.generateRefreshToken();
      expect(hash).not.toContain(token);
    });
  });
});
