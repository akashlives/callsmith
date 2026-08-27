import Redis from "ioredis";

import type { CreateRunInput } from "@/lib/contracts";

export const BROWSER_RUN_PENDING_QUEUE = "callsmith:browser-runs:pending";
export const BROWSER_RUN_PROCESSING_QUEUE = "callsmith:browser-runs:processing";

type QueueGlobals = typeof globalThis & {
  __callsmithQueueRedis?: Redis;
};

const queueGlobals = globalThis as QueueGlobals;

export type BrowserRunJob = {
  schemaVersion: 1;
  runId: string;
  input: CreateRunInput;
  enqueuedAt: string;
};

function redisUrl(): string | undefined {
  const value = process.env.REDIS_URL?.trim();
  return value || undefined;
}

function queueClient(): Redis {
  const url = redisUrl();
  if (!url) throw new Error("REDIS_URL is not configured for browser-native runs.");
  queueGlobals.__callsmithQueueRedis ??= new Redis(url, {
    enableReadyCheck: true,
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  });
  return queueGlobals.__callsmithQueueRedis;
}

export function browserQueueConfigured(): boolean {
  return Boolean(redisUrl());
}

export async function enqueueBrowserRun(
  runId: string,
  input: CreateRunInput,
): Promise<BrowserRunJob> {
  if (input.provenance !== "browser_webmcp") {
    throw new Error("Only browser_webmcp runs may enter the browser worker queue.");
  }
  const job: BrowserRunJob = {
    schemaVersion: 1,
    runId,
    input,
    enqueuedAt: new Date().toISOString(),
  };
  const redis = queueClient();
  if (redis.status === "wait") await redis.connect();
  await redis.lpush(BROWSER_RUN_PENDING_QUEUE, JSON.stringify(job));
  return job;
}

