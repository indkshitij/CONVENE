import { describe, expect, it } from "vitest";
import { qk, staleTimeFor } from "./query-keys";

describe("qk factory", () => {
  it("produces stable, deterministic keys for the same input", () => {
    expect(qk.conversation.messages("c1")).toEqual(qk.conversation.messages("c1"));
    expect(qk.profile.byId("u1")).toEqual(["profile", "byId", "u1"]);
  });

  it("distinguishes different ids", () => {
    expect(qk.conversation.messages("c1")).not.toEqual(qk.conversation.messages("c2"));
  });

  it("taxonomies default to an empty query string", () => {
    expect(qk.taxonomies.byKind("skills")).toEqual(["taxonomies", "skills", ""]);
  });
});

describe("staleTimeFor", () => {
  it("defaults to 30s", () => {
    expect(staleTimeFor(qk.profile.me())).toBe(30 * 1000);
    expect(staleTimeFor(qk.feed.home())).toBe(30 * 1000);
  });

  it("taxonomies get 5 minutes", () => {
    expect(staleTimeFor(qk.taxonomies.byKind("skills"))).toBe(5 * 60 * 1000);
  });

  it("conversation messages get 0 (always considered stale)", () => {
    expect(staleTimeFor(qk.conversation.messages("c1"))).toBe(0);
  });

  it("conversation list (not messages) still gets the 30s default", () => {
    expect(staleTimeFor(qk.conversation.list())).toBe(30 * 1000);
  });
});

describe("qk.requests.list and qk.conversation.list", () => {
  it("distinguishes received from sent, and different sort/status combinations", () => {
    expect(qk.requests.list("received")).not.toEqual(qk.requests.list("sent"));
    expect(qk.requests.list("received", "pending", "score_desc")).not.toEqual(
      qk.requests.list("received", "pending", "recent"),
    );
  });

  it("distinguishes each conversation filter", () => {
    expect(qk.conversation.list("all")).not.toEqual(qk.conversation.list("unread"));
    expect(qk.conversation.list("pinned")).not.toEqual(qk.conversation.list("archived"));
  });

  it("conversation.listPrefix is a strict prefix of every filter variant", () => {
    const prefix = qk.conversation.listPrefix();
    for (const filter of ["all", "unread", "pinned", "archived"] as const) {
      const full = qk.conversation.list(filter);
      expect(full.slice(0, prefix.length)).toEqual(prefix);
    }
  });
});
