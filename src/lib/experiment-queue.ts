import Redis from "ioredis";

const EXPERIMENT_JOB_STREAM = "callsmith:experiment-jobs:v1";
const EXPERIMENT_EVENT_PREFIX = "callsmith:experiment-events:v1:";
const EXPERIMENT_WORKER_HEARTBEAT = "callsmith:browser-worker:v1:heartbeat";

type ExperimentQueueGlobals = typeof globalThis & {
  __callsmithExperimentQueueRedis?: Redis;
};

const queueGlobals = globalThis as ExperimentQueueGlobals;

type ExperimentJobV1 = {
  schemaVersion: 1;
  experimentId: string;
  enqueuedAt: string;
};

export type ExperimentProgressEvent = {
  type:
    | "queued"
    | "started"
    | "attempt_started"
    | "attempt_completed"
    | "attempt_failed"
    | "completed";
  experimentId: string;
  at: string;
  contractVariant?: "weak" | "hardened";
  evidenceStatus?: "pending" | "conclusive" | "inconclusive" | "provider_failure";
  receiptAvailable?: boolean;
  message?: string;
};

function redisUrl(): string | undefined {
  return process.env.REDIS_URL?.trim() || undefined;
}

function client(): Redis {
  const url = redisUrl();
  if (!url) throw new Error("REDIS_URL is required for browser-native experiments");
  queueGlobals.__callsmithExperimentQueueRedis ??= new Redis(url, {
    enableReadyCheck: true,
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  });
  return queueGlobals.__callsmithExperimentQueueRedis;
}

async function connectedClient(): Promise<Redis> {
  const redis = client();
  if (redis.status === "wait") await redis.connect();
  return redis;
}

export function experimentQueueConfigured(): boolean {
  return Boolean(redisUrl());
}

export async function enqueueExperiment(experimentId: string): Promise<string> {
  const redis = await connectedClient();
  const job: ExperimentJobV1 = {
    schemaVersion: 1,
    experimentId,
    enqueuedAt: new Date().toISOString(),
  };
  const messageId = await redis.xadd(
    EXPERIMENT_JOB_STREAM,
    "*",
    "job",
    JSON.stringify(job),
  );
  if (!messageId) throw new Error("Redis did not acknowledge the experiment job");
  await publishExperimentEvent({
    type: "queued",
    experimentId,
    at: job.enqueuedAt,
    evidenceStatus: "pending",
  });
  return messageId;
}

export async function publishExperimentEvent(
  event: ExperimentProgressEvent,
): Promise<string> {
  const redis = await connectedClient();
  const messageId = await redis.xadd(
    `${EXPERIMENT_EVENT_PREFIX}${event.experimentId}`,
    "MAXLEN",
    "~",
    "512",
    "*",
    "event",
    JSON.stringify(event),
  );
  if (!messageId) throw new Error("Redis did not acknowledge the experiment event");
  return messageId;
}

export async function readExperimentEvents(
  experimentId: string,
  afterId: string,
  blockMs = 15_000,
): Promise<Array<{ id: string; event: ExperimentProgressEvent }>> {
  const redis = await connectedClient();
  const result = await redis.xread(
    "COUNT",
    32,
    "BLOCK",
    blockMs,
    "STREAMS",
    `${EXPERIMENT_EVENT_PREFIX}${experimentId}`,
    afterId,
  );
  if (!result) return [];
  return result.flatMap(([, messages]) =>
    messages.flatMap(([id, fields]) => {
      const eventIndex = fields.indexOf("event");
      if (eventIndex < 0 || typeof fields[eventIndex + 1] !== "string") return [];
      return [
        {
          id,
          event: JSON.parse(fields[eventIndex + 1]) as ExperimentProgressEvent,
        },
      ];
    }),
  );
}

export async function experimentQueueReady(): Promise<boolean> {
  if (!experimentQueueConfigured()) return false;
  try {
    return (await (await connectedClient()).ping()) === "PONG";
  } catch {
    return false;
  }
}

export async function browserWorkerReady(): Promise<boolean> {
  if (!(await experimentQueueReady())) return false;
  try {
    const heartbeat = await (await connectedClient()).get(
      EXPERIMENT_WORKER_HEARTBEAT,
    );
    if (!heartbeat) return false;
    const parsed = JSON.parse(heartbeat) as { draining?: unknown };
    return parsed.draining !== true;
  } catch {
    return false;
  }
}

export async function closeExperimentQueue(): Promise<void> {
  const redis = queueGlobals.__callsmithExperimentQueueRedis;
  queueGlobals.__callsmithExperimentQueueRedis = undefined;
  if (redis && redis.status !== "end") await redis.quit();
}
