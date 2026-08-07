import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { EmbeddingRefreshProducer } from "./embedding-refresh.producer";
import { PROFILE_UPDATED_EVENT, type ProfileUpdatedEvent } from "./profile-events";

// BR-PROF-09: "Editing headline, about, skills, or job_title invalidates
// the user's embedding and enqueues recomputation (debounced 60s)."
// `industry` is composed into the embedding text (embedding-text.ts) but
// isn't named in BR-PROF-09's own invalidation trigger list — flagged as
// a PRD-internal gap (same as this phase's other documented gaps) rather
// than silently expanding the rule beyond its literal wording.
const EMBEDDING_TRIGGER_FIELDS = new Set(["headline", "about", "skills", "job_title"]);

@Injectable()
export class EmbeddingRefreshListener {
  constructor(private readonly producer: EmbeddingRefreshProducer) {}

  @OnEvent(PROFILE_UPDATED_EVENT)
  async handleProfileUpdated(event: ProfileUpdatedEvent): Promise<void> {
    if (!event.changedFields.some((field) => EMBEDDING_TRIGGER_FIELDS.has(field))) return;
    await this.producer.enqueueRefresh(event.userId);
  }
}
