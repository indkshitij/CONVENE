import { describe, expect, it, vi } from "vitest";
import { EmbeddingRefreshListener } from "./embedding-refresh.listener";
import type { EmbeddingRefreshProducer } from "./embedding-refresh.producer";

function makeListener() {
  const enqueueRefresh = vi.fn(async () => undefined);
  const producer = { enqueueRefresh } as unknown as EmbeddingRefreshProducer;
  return { listener: new EmbeddingRefreshListener(producer), enqueueRefresh };
}

// P7.4 prompt's own testing requirement: "assert no provider call occurs
// on an unrelated profile update." This listener is the gate before the
// (potentially paid) provider is ever reached — asserting it doesn't even
// enqueue a job is the first line of that guarantee; embedding.service's
// own hash check (embedding.service.integration.test.ts) is the second.
describe("EmbeddingRefreshListener", () => {
  it("enqueues a refresh when a BR-PROF-09 trigger field changed", async () => {
    const { listener, enqueueRefresh } = makeListener();
    await listener.handleProfileUpdated({ userId: "u1", changedFields: ["headline"] });
    expect(enqueueRefresh).toHaveBeenCalledWith("u1");
  });

  it("does not enqueue anything for an unrelated field change (e.g. timezone)", async () => {
    const { listener, enqueueRefresh } = makeListener();
    await listener.handleProfileUpdated({
      userId: "u1",
      changedFields: ["timezone", "open_to_relocate"],
    });
    expect(enqueueRefresh).not.toHaveBeenCalled();
  });

  it("enqueues when at least one of several changed fields is a trigger field", async () => {
    const { listener, enqueueRefresh } = makeListener();
    await listener.handleProfileUpdated({ userId: "u1", changedFields: ["timezone", "job_title"] });
    expect(enqueueRefresh).toHaveBeenCalledWith("u1");
  });

  it("does nothing for an empty changedFields list", async () => {
    const { listener, enqueueRefresh } = makeListener();
    await listener.handleProfileUpdated({ userId: "u1", changedFields: [] });
    expect(enqueueRefresh).not.toHaveBeenCalled();
  });
});
