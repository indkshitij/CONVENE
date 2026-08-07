import { generateKeyPair as generateKeyPairCallback, createPublicKey } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { Inject, Injectable } from "@nestjs/common";
import { uuidv7 } from "../../../common/utils/uuidv7";

const generateKeyPairAsync = promisify(generateKeyPairCallback);

export interface KeyRecord {
  kid: string;
  privateKeyPem: string;
  publicKeyPem: string;
  createdAt: string;
}

// PRD §17.4: "RSA-2048 signing keys in a KMS, rotated every 90 days, with
// both the current and previous public keys published at
// /.well-known/jwks.json." Only the two most recent keys are ever
// retained — a third rotation drops the oldest, since in-flight tokens
// only need to survive a single rotation window.
const KEY_RETENTION_COUNT = 2;

export interface KeyProvider {
  getCurrentKey(): Promise<KeyRecord>;
  getPublicKeys(): Promise<KeyRecord[]>;
  rotate(): Promise<KeyRecord>;
}

export const KEY_PROVIDER = "KEY_PROVIDER";

async function generateRsaKeyRecord(): Promise<KeyRecord> {
  const { privateKey, publicKey } = await generateKeyPairAsync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return {
    kid: uuidv7(),
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
    createdAt: new Date().toISOString(),
  };
}

// PRD P5.1: "Signing keys from a KMS abstraction (local file provider in
// dev)." This is that local-file provider — a real KMS (AWS KMS, GCP KMS,
// etc.) implements the same KeyProvider interface in production without
// this service or its callers changing.
export class LocalFileKeyProvider implements KeyProvider {
  constructor(private readonly filePath: string) {}

  private async readStore(): Promise<KeyRecord[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as KeyRecord[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async writeStore(keys: KeyRecord[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(keys, null, 2), "utf8");
  }

  async getCurrentKey(): Promise<KeyRecord> {
    const keys = await this.readStore();
    if (keys.length === 0) return this.rotate();
    return keys[0] as KeyRecord;
  }

  async getPublicKeys(): Promise<KeyRecord[]> {
    const keys = await this.readStore();
    if (keys.length === 0) {
      await this.rotate();
      return this.readStore();
    }
    return keys;
  }

  async rotate(): Promise<KeyRecord> {
    const newKey = await generateRsaKeyRecord();
    const existing = await this.readStore();
    const updated = [newKey, ...existing].slice(0, KEY_RETENTION_COUNT);
    await this.writeStore(updated);
    return newKey;
  }
}

export interface Jwk {
  kty: string;
  n: string;
  e: string;
  kid: string;
  use: string;
  alg: string;
}

@Injectable()
export class JwksService {
  constructor(@Inject(KEY_PROVIDER) private readonly provider: KeyProvider) {}

  async getSigningKey(): Promise<{ kid: string; privateKeyPem: string }> {
    const current = await this.provider.getCurrentKey();
    return { kid: current.kid, privateKeyPem: current.privateKeyPem };
  }

  // Every currently-valid public key (current + previous) — used by
  // token.service.ts to verify an access token signed with either.
  async getVerificationKeys(): Promise<Array<{ kid: string; publicKeyPem: string }>> {
    const keys = await this.provider.getPublicKeys();
    return keys.map((key) => ({ kid: key.kid, publicKeyPem: key.publicKeyPem }));
  }

  async rotate(): Promise<void> {
    await this.provider.rotate();
  }

  // PRD §17.4: served at GET /.well-known/jwks.json.
  async getJwks(): Promise<{ keys: Jwk[] }> {
    const keys = await this.provider.getPublicKeys();
    return {
      keys: keys.map((key) => {
        const jwk = createPublicKey(key.publicKeyPem).export({ format: "jwk" }) as {
          n: string;
          e: string;
        };
        return { kty: "RSA", n: jwk.n, e: jwk.e, kid: key.kid, use: "sig", alg: "RS256" };
      }),
    };
  }
}
