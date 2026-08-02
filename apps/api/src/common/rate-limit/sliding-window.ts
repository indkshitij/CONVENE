import { readFileSync } from "node:fs";
import { join } from "node:path";
import type Redis from "ioredis";

const SLIDING_WINDOW_SCRIPT = readFileSync(join(__dirname, "sliding-window.lua"), "utf8");

export interface SlidingWindowResult {
  allowed: boolean;
  count: number;
}

interface RedisWithSlidingWindow {
  slidingWindow(
    key: string,
    now: number,
    window: number,
    limit: number,
    member: string,
  ): Promise<[number, number]>;
}

// ioredis's defineCommand registers the command on a specific *instance*,
// not the class — tracked per-client so re-registering on the same client
// is a no-op, but a fresh client (e.g. a new one in each test) still gets
// the command defined exactly once.
const registeredClients = new WeakSet<Redis>();

function ensureCommandRegistered(client: Redis): void {
  if (registeredClients.has(client)) return;
  client.defineCommand("slidingWindow", { numberOfKeys: 1, lua: SLIDING_WINDOW_SCRIPT });
  registeredClients.add(client);
}

export async function evalSlidingWindow(
  client: Redis,
  key: string,
  nowMs: number,
  windowMs: number,
  limit: number,
  member: string,
): Promise<SlidingWindowResult> {
  ensureCommandRegistered(client);
  const [allowed, count] = await (client as unknown as RedisWithSlidingWindow).slidingWindow(
    key,
    nowMs,
    windowMs,
    limit,
    member,
  );
  return { allowed: allowed === 1, count };
}
