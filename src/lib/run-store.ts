import {
  AttemptResultSchema,
  CreateRunInputSchema,
  RunResultSchema,
  type AttemptResult,
  type CreateRunInput,
  type RunResult,
} from "@/lib/contracts";
import { redactSecrets } from "@/lib/evaluation";
import {
  loadRun,
  loadRunByShareToken,
  persistRun,
} from "@/lib/run-persistence";

export type RunListener = (run: RunResult) => void;
export type RunUpdater =
  | Partial<Omit<RunResult, "id" | "createdAt" | "evidenceStatus">>
  | ((current: RunResult) => RunResult);

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sanitizeAttempt(attempt: AttemptResult): AttemptResult {
  return redactSecrets(attempt as unknown as import("@/lib/contracts").JsonValue) as unknown as AttemptResult;
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export class InMemoryRunStore {
  readonly #runs = new Map<string, RunResult>();
  readonly #shareIndex = new Map<string, string>();
  readonly #listeners = new Map<string, Set<RunListener>>();

  create(input: CreateRunInput): RunResult {
    const validated = CreateRunInputSchema.parse(input);
    const now = new Date().toISOString();
    const run = RunResultSchema.parse({
      id: newId("run"),
      ...validated,
      status: "queued",
      attempts: [],
      createdAt: now,
      updatedAt: now,
    });
    this.#runs.set(run.id, run);
    this.#persist(run);
    return clone(run);
  }

  get(id: string): RunResult | undefined {
    const run = this.#runs.get(id);
    return run ? clone(run) : undefined;
  }

  async getPersistent(id: string): Promise<RunResult | undefined> {
    const active = this.get(id);
    if (active) return active;
    const stored = await loadRun(id);
    if (stored) this.#hydrate(stored);
    return stored ? clone(stored) : undefined;
  }

  update(id: string, updater: RunUpdater): RunResult {
    const existing = this.#runs.get(id);
    if (!existing) throw new Error(`Unknown run \"${id}\"`);

    const current = clone(existing);
    const candidate =
      typeof updater === "function"
        ? updater(current)
        : { ...current, ...clone(updater), id: existing.id, createdAt: existing.createdAt };
    const next = RunResultSchema.parse({
      ...candidate,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    });
    this.#runs.set(id, next);
    this.#persist(next);
    this.#notify(id, next);
    return clone(next);
  }

  appendAttempt(id: string, attempt: AttemptResult): RunResult {
    const validated = sanitizeAttempt(AttemptResultSchema.parse(attempt));
    return this.update(id, (run) => ({
      ...run,
      attempts: [...run.attempts, validated],
    }));
  }

  subscribe(id: string, listener: RunListener): () => void {
    if (!this.#runs.has(id)) throw new Error(`Unknown run \"${id}\"`);
    const listeners = this.#listeners.get(id) ?? new Set<RunListener>();
    listeners.add(listener);
    this.#listeners.set(id, listeners);
    return () => {
      const active = this.#listeners.get(id);
      active?.delete(listener);
      if (active?.size === 0) this.#listeners.delete(id);
    };
  }

  share(id: string): string {
    const existing = this.#runs.get(id);
    if (!existing) throw new Error(`Unknown run \"${id}\"`);
    if (existing.shareToken) return existing.shareToken;

    const encodedRunId = Buffer.from(id, "utf8").toString("base64url");
    const token = `${encodedRunId}.${crypto.randomUUID().replaceAll("-", "")}`;
    this.#shareIndex.set(token, id);
    this.update(id, { shareToken: token });
    return token;
  }

  getByShareToken(token: string): Readonly<RunResult> | undefined {
    const id = this.#shareIndex.get(token);
    return id ? this.get(id) : undefined;
  }

  async getByShareTokenPersistent(
    token: string,
  ): Promise<Readonly<RunResult> | undefined> {
    const active = this.getByShareToken(token);
    if (active) return active;
    const stored = await loadRunByShareToken(token);
    if (stored) this.#hydrate(stored);
    return stored ? clone(stored) : undefined;
  }

  async sharePersistent(id: string): Promise<string> {
    const run = await this.getPersistent(id);
    if (!run) throw new Error(`Unknown run \"${id}\"`);
    const token = this.share(id);
    const shared = this.get(id);
    if (shared) await persistRun(shared);
    return token;
  }

  clear(): void {
    this.#runs.clear();
    this.#shareIndex.clear();
    this.#listeners.clear();
  }

  get size(): number {
    return this.#runs.size;
  }

  #notify(id: string, run: RunResult): void {
    for (const listener of this.#listeners.get(id) ?? []) {
      listener(clone(run));
    }
  }

  #hydrate(run: RunResult): void {
    const validated = RunResultSchema.parse(run);
    this.#runs.set(validated.id, validated);
    if (validated.shareToken) {
      this.#shareIndex.set(validated.shareToken, validated.id);
    }
  }

  #persist(run: RunResult): void {
    void persistRun(clone(run)).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown persistence error";
      console.error(`[callsmith] run persistence failed: ${message}`);
    });
  }
}

const processRunStore = process as NodeJS.Process & {
  __callsmithRunStore?: InMemoryRunStore;
};

/**
 * Next.js can evaluate route and page bundles independently inside one Node
 * process. Keeping the store on `globalThis` makes a run created by an API
 * route visible to the SSE route and read-only report page in that process.
 * The production adapter can replace this singleton with Postgres/Redis
 * without changing callers.
 */
export const runStore =
  processRunStore.__callsmithRunStore instanceof InMemoryRunStore
    ? processRunStore.__callsmithRunStore
    : (processRunStore.__callsmithRunStore = new InMemoryRunStore());

export function createRun(input: CreateRunInput): RunResult {
  return runStore.create(input);
}

export function getRun(id: string): RunResult | undefined {
  return runStore.get(id);
}

export function shareRun(id: string): string {
  return runStore.share(id);
}
