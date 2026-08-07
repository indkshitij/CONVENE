import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { HttpFetcher } from "./password.service";
import { PasswordService } from "./password.service";

function fakeFetcher(response: { ok: boolean; text: string }): HttpFetcher {
  return vi.fn().mockResolvedValue({ ok: response.ok, text: async () => response.text });
}

describe("PasswordService", () => {
  describe("hash / verify", () => {
    it("round-trips: a hashed password verifies against the original", async () => {
      const service = new PasswordService(fakeFetcher({ ok: true, text: "" }));
      const hash = await service.hash("correct-horse-9");
      await expect(service.verify(hash, "correct-horse-9")).resolves.toBe(true);
    });

    it("rejects an incorrect password", async () => {
      const service = new PasswordService(fakeFetcher({ ok: true, text: "" }));
      const hash = await service.hash("correct-horse-9");
      await expect(service.verify(hash, "wrong-password")).resolves.toBe(false);
    });

    it("produces a hash tagged as argon2id with the documented parameters", async () => {
      const service = new PasswordService(fakeFetcher({ ok: true, text: "" }));
      const hash = await service.hash("correct-horse-9");
      expect(hash).toMatch(/^\$argon2id\$v=\d+\$m=65536,p=4,t=3\$/);
    });

    it("produces a different hash each time (fresh random salt per call)", async () => {
      const service = new PasswordService(fakeFetcher({ ok: true, text: "" }));
      const a = await service.hash("correct-horse-9");
      const b = await service.hash("correct-horse-9");
      expect(a).not.toBe(b);
    });

    // PRD's own testing note: "assert the timing of a verify against a
    // wrong password is not trivially distinguishable." Averaged over
    // several repetitions (Argon2id's own cost dominates the timing, so
    // this should hold well within a generous tolerance) to avoid flaking
    // on a single noisy sample.
    it("does not make verifying a wrong password trivially faster than a correct one", async () => {
      const service = new PasswordService(fakeFetcher({ ok: true, text: "" }));
      const hash = await service.hash("correct-horse-9");
      const REPS = 5;

      const correctStart = process.hrtime.bigint();
      for (let i = 0; i < REPS; i++) await service.verify(hash, "correct-horse-9");
      const correctDurationMs = Number(process.hrtime.bigint() - correctStart) / 1e6;

      const wrongStart = process.hrtime.bigint();
      for (let i = 0; i < REPS; i++) await service.verify(hash, "wrong-password");
      const wrongDurationMs = Number(process.hrtime.bigint() - wrongStart) / 1e6;

      const ratio = wrongDurationMs / correctDurationMs;
      expect(ratio).toBeGreaterThan(0.5);
      expect(ratio).toBeLessThan(2.0);
    }, 20_000);
  });

  describe("isBreached", () => {
    it("returns true when the suffix appears in the HIBP range response", async () => {
      const password = "password123";
      const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
      const suffix = sha1.slice(5);
      const service = new PasswordService(
        fakeFetcher({ ok: true, text: `${suffix}:12345\nAAAA:1` }),
      );
      await expect(service.isBreached(password)).resolves.toBe(true);
    });

    it("returns false when the suffix does not appear", async () => {
      const service = new PasswordService(fakeFetcher({ ok: true, text: "AAAA:1\nBBBB:2" }));
      await expect(service.isBreached("some-unbreached-password")).resolves.toBe(false);
    });

    it("only sends the first 5 hex chars of the SHA-1 digest, never the full hash or password", async () => {
      const password = "password123";
      const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
      const prefix = sha1.slice(0, 5);
      const fetcher = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
      const service = new PasswordService(fetcher);

      await service.isBreached(password);

      expect(fetcher).toHaveBeenCalledTimes(1);
      const calledUrl = fetcher.mock.calls[0]?.[0] as string;
      expect(calledUrl).toContain(prefix);
      expect(calledUrl).not.toContain(sha1);
      expect(calledUrl).not.toContain(password);
    });

    it("fails open (returns false) when the HIBP API responds with a non-ok status", async () => {
      const service = new PasswordService(fakeFetcher({ ok: false, text: "" }));
      await expect(service.isBreached("anything")).resolves.toBe(false);
    });

    it("fails open (returns false) when the fetch itself throws", async () => {
      const fetcher: HttpFetcher = vi.fn().mockRejectedValue(new Error("network down"));
      const service = new PasswordService(fetcher);
      await expect(service.isBreached("anything")).resolves.toBe(false);
    });
  });
});
