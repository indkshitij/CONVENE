import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INestApplication, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthController } from "./auth.controller";
import { JwksService, KEY_PROVIDER, LocalFileKeyProvider } from "./services/jwks.service";

describe("AuthController — GET /.well-known/jwks.json", () => {
  let dir: string;
  let app: INestApplication;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "convene-auth-controller-test-"));

    @Module({
      controllers: [AuthController],
      providers: [
        { provide: KEY_PROVIDER, useValue: new LocalFileKeyProvider(join(dir, "keys.json")) },
        JwksService,
      ],
    })
    class TestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("serves a JWKS document with at least one RS256 signing key", async () => {
    const response = await request(app.getHttpServer()).get("/.well-known/jwks.json");

    expect(response.status).toBe(200);
    expect(response.body.keys).toHaveLength(1);
    expect(response.body.keys[0]).toMatchObject({ kty: "RSA", alg: "RS256", use: "sig" });
    expect(typeof response.body.keys[0].kid).toBe("string");
    expect(typeof response.body.keys[0].n).toBe("string");
    expect(typeof response.body.keys[0].e).toBe("string");
  });

  it("never includes private key material in the response", async () => {
    const response = await request(app.getHttpServer()).get("/.well-known/jwks.json");
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("PRIVATE KEY");
  });
});
