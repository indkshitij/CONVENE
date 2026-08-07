import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Worker, type Job } from "bullmq";
import { BullmqConnectionService } from "../infra/queue/bullmq-connection.service";
import { EmbeddingService } from "../modules/profile/embedding.service";
import {
  EMBEDDING_REFRESH_QUEUE,
  type EmbeddingRefreshJobData,
} from "../modules/profile/embedding-refresh.producer";

// PRD §17.2 W1/WK3. Started/stopped with the Nest application lifecycle
// rather than a separate process — this codebase runs one API process in
// dev/test (per docker-compose); splitting workers into their own
// deployable process is an infra decision for whichever phase sets up
// production deployment, not this prompt's scope.
@Injectable()
export class EmbeddingRefreshWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<EmbeddingRefreshJobData> | undefined;

  constructor(
    private readonly connectionService: BullmqConnectionService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<EmbeddingRefreshJobData>(
      EMBEDDING_REFRESH_QUEUE,
      async (job: Job<EmbeddingRefreshJobData>) => {
        await this.embeddingService.refreshEmbedding(job.data.userId);
      },
      { connection: this.connectionService.client },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
