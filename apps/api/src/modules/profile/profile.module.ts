import { Module } from "@nestjs/common";
import { EmbeddingRefreshWorker } from "../../workers/embedding-refresh.worker";
import { AuthModule } from "../auth/auth.module";
import { TaxonomyModule } from "../taxonomy/taxonomy.module";
import { CompletionService } from "./completion.service";
import { DeterministicStubEmbeddingProvider, EMBEDDING_PROVIDER } from "./embedding-provider";
import { EmbeddingRefreshListener } from "./embedding-refresh.listener";
import { EmbeddingRefreshProducer } from "./embedding-refresh.producer";
import { EmbeddingService } from "./embedding.service";
import { ProfileChildrenController } from "./profile-children.controller";
import { ProfileChildrenService } from "./profile-children.service";
import { ProfileController } from "./profile.controller";
import { ProfileService } from "./profile.service";
import { VerificationLadderController } from "./verification-ladder.controller";
import { VerificationLadderService } from "./verification-ladder.service";

// PRD §17.2 — see README.md in this directory for owned tables and events.
// P7.1: profile read (endpoints 12/13) + update (14). P7.2: children CRUD
// (endpoint 15) — needs TaxonomyModule for skill/interest resolution.
// P7.3: completion (endpoint 17) + verification ladder (endpoint 16) —
// the latter needs AuthModule's VerificationService (single-use token
// table, shared with email_verify/password_reset) and EmailService.
// P7.4: profile_embeddings maintenance — EmbeddingService (source_hash
// cost control), EmbeddingRefreshProducer/Worker (BullMQ, debounced
// 60s/BR-PROF-09), EmbeddingRefreshListener (bridges the profile.updated
// event ProfileService/ProfileChildrenService emit to the producer). Real
// delivery (a Voyage AI client) swaps EMBEDDING_PROVIDER's useClass —
// not built this phase, same precedent as EMAIL_TRANSPORT.
@Module({
  imports: [TaxonomyModule, AuthModule],
  controllers: [ProfileController, ProfileChildrenController, VerificationLadderController],
  providers: [
    ProfileService,
    ProfileChildrenService,
    CompletionService,
    VerificationLadderService,
    { provide: EMBEDDING_PROVIDER, useClass: DeterministicStubEmbeddingProvider },
    EmbeddingService,
    EmbeddingRefreshProducer,
    EmbeddingRefreshListener,
    EmbeddingRefreshWorker,
  ],
  exports: [
    ProfileService,
    ProfileChildrenService,
    CompletionService,
    VerificationLadderService,
    EmbeddingService,
  ],
})
export class ProfileModule {}
