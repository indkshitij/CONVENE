import { Injectable } from "@nestjs/common";
import { hashingTrickEmbedding } from "./embedding-vector";

// PRD §... "voyage-3" (1024-d) is the named default model; alternatives
// (OpenAI text-embedding-3, self-host) are swappable via this same
// interface — matches profile_embeddings.embedding's vector(1024) column.
export const EMBEDDING_DIMENSIONS = 1024;
export const EMBEDDING_MODEL = "voyage-3";

export const EMBEDDING_PROVIDER = "EMBEDDING_PROVIDER";

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

// Dev/test default — no network call, no API key, deterministic. Real
// delivery (a Voyage AI client, or whichever vendor) is a separate
// EmbeddingProvider implementation swapped in by whichever deployment
// config wires this module up; not built this phase, same precedent as
// ConsoleEmailTransport/EMAIL_TRANSPORT in modules/notifications/email.service.ts.
@Injectable()
export class DeterministicStubEmbeddingProvider implements EmbeddingProvider {
  async embed(text: string): Promise<number[]> {
    return hashingTrickEmbedding(text, EMBEDDING_DIMENSIONS);
  }
}
