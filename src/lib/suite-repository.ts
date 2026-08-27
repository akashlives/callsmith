import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import {
  JsonObjectSchema,
  SuiteDefinitionSchema,
  type JsonObject,
  type SuiteDefinition,
} from "@/lib/contracts";
import {
  PostgresSuiteRepositoryBackend,
  suitePersistenceConfigured,
} from "@/lib/suite-persistence";
import { getSuite } from "@/lib/suites";

export const DEFAULT_CONFIRMATION_TTL_MS = 5 * 60 * 1_000;
export const MAX_DRAFT_BYTES = 256 * 1_024;

export type SuiteDraftStatus =
  | "draft"
  | "awaiting_confirmation"
  | "published"
  | "rejected";

export interface SuiteDraftRecord {
  id: string;
  draft: JsonObject;
  status: SuiteDraftStatus;
  candidateSuite?: SuiteDefinition;
  confirmationExpiresAt?: string;
  publishedSuiteId?: string;
  publishedSuiteVersion?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  revision: number;
}

export interface UnlistedSuiteRecord {
  id: string;
  suiteId: string;
  suiteVersion: string;
  sourceDraftId: string;
  definition: SuiteDefinition;
  publishedAt: string;
}

export interface CreatedSuiteDraft {
  draft: SuiteDraftRecord;
  ownerToken: string;
}

export interface SuiteApprovalChallenge {
  draft: SuiteDraftRecord;
  confirmationToken: string;
  expiresAt: string;
}

export interface PublishedSuiteHandle {
  draft: SuiteDraftRecord;
  suite: UnlistedSuiteRecord;
  capabilityToken: string;
}

export type SuiteRepositoryErrorCode =
  | "INVALID_DRAFT"
  | "DRAFT_TOO_LARGE"
  | "INVALID_SUITE"
  | "DRAFT_NOT_FOUND"
  | "DRAFT_REJECTED"
  | "DRAFT_ALREADY_PUBLISHED"
  | "CONFIRMATION_REQUIRED"
  | "CONFIRMATION_INVALID"
  | "CONFIRMATION_EXPIRED"
  | "STALE_DRAFT"
  | "SUITE_VERSION_EXISTS";

export class SuiteRepositoryError extends Error {
  constructor(
    public readonly code: SuiteRepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SuiteRepositoryError";
  }
}

/** @internal Persisted form. Capability hashes are intentionally omitted from public records. */
export interface StoredSuiteDraft extends SuiteDraftRecord {
  ownerTokenHash: string;
  confirmationTokenHash?: string;
}

/** @internal Persisted form. The raw suite capability is returned once and never stored. */
export interface StoredUnlistedSuite extends UnlistedSuiteRecord {
  capabilityTokenHash: string;
}

export type PublishBackendResult =
  | { kind: "published" }
  | { kind: "stale" }
  | { kind: "version_conflict" };

export interface SuiteRepositoryBackend {
  createDraft(record: StoredSuiteDraft): Promise<void>;
  findDraft(id: string, ownerTokenHash: string): Promise<StoredSuiteDraft | undefined>;
  saveDraft(record: StoredSuiteDraft, expectedRevision: number): Promise<boolean>;
  publishDraft(
    draft: StoredSuiteDraft,
    expectedRevision: number,
    suite: StoredUnlistedSuite,
  ): Promise<PublishBackendResult>;
  findSuiteByCapabilityHash(
    capabilityTokenHash: string,
  ): Promise<StoredUnlistedSuite | undefined>;
  findSuiteByVersion(
    suiteId: string,
    suiteVersion: string,
  ): Promise<StoredUnlistedSuite | undefined>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function publicDraft(record: StoredSuiteDraft): SuiteDraftRecord {
  const result = clone(record) as unknown as Record<string, unknown>;
  delete result.ownerTokenHash;
  delete result.confirmationTokenHash;
  for (const [key, value] of Object.entries(result)) {
    if (value === undefined) delete result[key];
  }
  return result as unknown as SuiteDraftRecord;
}

function publicSuite(record: StoredUnlistedSuite): UnlistedSuiteRecord {
  const result = clone(record) as unknown as Record<string, unknown>;
  delete result.capabilityTokenHash;
  return result as unknown as UnlistedSuiteRecord;
}

function versionKey(suiteId: string, suiteVersion: string): string {
  return JSON.stringify([suiteId, suiteVersion]);
}

function opaqueToken(kind: "owner" | "confirm" | "suite"): string {
  return `cs_${kind}_${randomBytes(32).toString("base64url")}`;
}

function tokenHash(kind: "owner" | "confirm" | "suite", token: string): string {
  return createHash("sha256")
    .update(`callsmith:${kind}:v1:${token}`, "utf8")
    .digest("hex");
}

function hashesEqual(left: string, right: string): boolean {
  if (
    !/^[a-f0-9]{64}$/.test(left) ||
    !/^[a-f0-9]{64}$/.test(right) ||
    left.length !== right.length
  ) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function assertBoundedJson(
  input: unknown,
  invalidCode: "INVALID_DRAFT" | "INVALID_SUITE",
  label: "draft" | "candidate suite",
): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input);
  } catch {
    throw new SuiteRepositoryError(
      invalidCode,
      `The ${label} must be serializable JSON.`,
    );
  }
  if (serialized === undefined) {
    throw new SuiteRepositoryError(
      invalidCode,
      `The ${label} must be serializable JSON.`,
    );
  }
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > MAX_DRAFT_BYTES) {
    throw new SuiteRepositoryError(
      "DRAFT_TOO_LARGE",
      `The ${label} cannot exceed ${MAX_DRAFT_BYTES} bytes.`,
    );
  }
}

export interface InMemorySuiteRepositorySnapshot {
  drafts: StoredSuiteDraft[];
  suites: StoredUnlistedSuite[];
}

/**
 * Local/test backend. Reuse one instance across SuiteRepository instances to
 * model repository re-instantiation without leaking state through globals.
 */
export class InMemorySuiteRepositoryBackend implements SuiteRepositoryBackend {
  readonly #drafts = new Map<string, StoredSuiteDraft>();
  readonly #suitesByVersion = new Map<string, StoredUnlistedSuite>();
  readonly #suiteVersionByCapabilityHash = new Map<string, string>();

  async createDraft(record: StoredSuiteDraft): Promise<void> {
    if (this.#drafts.has(record.id)) throw new Error(`Duplicate draft id ${record.id}`);
    this.#drafts.set(record.id, clone(record));
  }

  async findDraft(
    id: string,
    ownerTokenHash: string,
  ): Promise<StoredSuiteDraft | undefined> {
    const draft = this.#drafts.get(id);
    return draft && hashesEqual(draft.ownerTokenHash, ownerTokenHash)
      ? clone(draft)
      : undefined;
  }

  async saveDraft(
    record: StoredSuiteDraft,
    expectedRevision: number,
  ): Promise<boolean> {
    const current = this.#drafts.get(record.id);
    if (
      !current ||
      current.revision !== expectedRevision ||
      !hashesEqual(current.ownerTokenHash, record.ownerTokenHash)
    ) {
      return false;
    }
    this.#drafts.set(record.id, clone(record));
    return true;
  }

  async publishDraft(
    draft: StoredSuiteDraft,
    expectedRevision: number,
    suite: StoredUnlistedSuite,
  ): Promise<PublishBackendResult> {
    const current = this.#drafts.get(draft.id);
    if (
      !current ||
      current.revision !== expectedRevision ||
      current.status !== "awaiting_confirmation" ||
      !hashesEqual(current.ownerTokenHash, draft.ownerTokenHash)
    ) {
      return { kind: "stale" };
    }
    const key = versionKey(suite.suiteId, suite.suiteVersion);
    if (
      this.#suitesByVersion.has(key) ||
      [...this.#suitesByVersion.values()].some(
        (value) => value.sourceDraftId === suite.sourceDraftId,
      )
    ) {
      return { kind: "version_conflict" };
    }
    this.#drafts.set(draft.id, clone(draft));
    this.#suitesByVersion.set(key, clone(suite));
    this.#suiteVersionByCapabilityHash.set(suite.capabilityTokenHash, key);
    return { kind: "published" };
  }

  async findSuiteByCapabilityHash(
    capabilityTokenHash: string,
  ): Promise<StoredUnlistedSuite | undefined> {
    const key = this.#suiteVersionByCapabilityHash.get(capabilityTokenHash);
    const suite = key ? this.#suitesByVersion.get(key) : undefined;
    return suite ? clone(suite) : undefined;
  }

  async findSuiteByVersion(
    suiteId: string,
    suiteVersion: string,
  ): Promise<StoredUnlistedSuite | undefined> {
    const suite = this.#suitesByVersion.get(versionKey(suiteId, suiteVersion));
    return suite ? clone(suite) : undefined;
  }

  snapshot(): InMemorySuiteRepositorySnapshot {
    return {
      drafts: [...this.#drafts.values()].map(clone),
      suites: [...this.#suitesByVersion.values()].map(clone),
    };
  }

  clear(): void {
    this.#drafts.clear();
    this.#suitesByVersion.clear();
    this.#suiteVersionByCapabilityHash.clear();
  }
}

export interface SuiteRepositoryOptions {
  now?: () => Date;
  confirmationTtlMs?: number;
}

export class SuiteRepository {
  readonly #backend: SuiteRepositoryBackend;
  readonly #now: () => Date;
  readonly #confirmationTtlMs: number;

  constructor(
    backend: SuiteRepositoryBackend,
    options: SuiteRepositoryOptions = {},
  ) {
    this.#backend = backend;
    this.#now = options.now ?? (() => new Date());
    this.#confirmationTtlMs =
      options.confirmationTtlMs ?? DEFAULT_CONFIRMATION_TTL_MS;
    if (
      !Number.isSafeInteger(this.#confirmationTtlMs) ||
      this.#confirmationTtlMs < 1 ||
      this.#confirmationTtlMs > 15 * 60 * 1_000
    ) {
      throw new Error("confirmationTtlMs must be between 1ms and 15 minutes");
    }
  }

  async createDraft(input: unknown): Promise<CreatedSuiteDraft> {
    assertBoundedJson(input, "INVALID_DRAFT", "draft");
    const parsed = JsonObjectSchema.safeParse(input);
    if (!parsed.success) {
      throw new SuiteRepositoryError(
        "INVALID_DRAFT",
        "Suite drafts must be JSON objects without executable values.",
      );
    }
    const ownerToken = opaqueToken("owner");
    const now = this.#now().toISOString();
    const record: StoredSuiteDraft = {
      id: `draft-${randomUUID()}`,
      draft: clone(parsed.data),
      status: "draft",
      createdAt: now,
      updatedAt: now,
      revision: 0,
      ownerTokenHash: tokenHash("owner", ownerToken),
    };
    await this.#backend.createDraft(record);
    return { draft: publicDraft(record), ownerToken };
  }

  async getDraft(
    draftId: string,
    ownerToken: string,
  ): Promise<SuiteDraftRecord | undefined> {
    const record = await this.#backend.findDraft(
      draftId,
      tokenHash("owner", ownerToken),
    );
    return record ? publicDraft(record) : undefined;
  }

  async requestApproval(
    draftId: string,
    ownerToken: string,
    suiteInput: unknown,
  ): Promise<SuiteApprovalChallenge> {
    const current = await this.#ownedDraft(draftId, ownerToken);
    this.#assertDraftCanChange(current);

    assertBoundedJson(suiteInput, "INVALID_SUITE", "candidate suite");
    const parsedSuite = SuiteDefinitionSchema.safeParse(suiteInput);
    if (!parsedSuite.success) {
      throw new SuiteRepositoryError(
        "INVALID_SUITE",
        "The candidate suite does not satisfy the safe SuiteDefinition contract.",
      );
    }
    const confirmationToken = opaqueToken("confirm");
    const now = this.#now();
    const expiresAt = new Date(
      now.getTime() + this.#confirmationTtlMs,
    ).toISOString();
    const next: StoredSuiteDraft = {
      ...current,
      status: "awaiting_confirmation",
      candidateSuite: clone(parsedSuite.data),
      confirmationTokenHash: tokenHash("confirm", confirmationToken),
      confirmationExpiresAt: expiresAt,
      updatedAt: now.toISOString(),
      revision: current.revision + 1,
    };
    if (!(await this.#backend.saveDraft(next, current.revision))) {
      throw new SuiteRepositoryError(
        "STALE_DRAFT",
        "The draft changed while approval was being prepared.",
      );
    }
    return { draft: publicDraft(next), confirmationToken, expiresAt };
  }

  async approveDraft(
    draftId: string,
    ownerToken: string,
    confirmationToken: string,
  ): Promise<PublishedSuiteHandle> {
    const current = await this.#ownedDraft(draftId, ownerToken);
    this.#assertDraftCanChange(current);
    if (
      current.status !== "awaiting_confirmation" ||
      !current.candidateSuite ||
      !current.confirmationTokenHash ||
      !current.confirmationExpiresAt
    ) {
      throw new SuiteRepositoryError(
        "CONFIRMATION_REQUIRED",
        "This draft does not have an active approval challenge.",
      );
    }
    const suppliedHash = tokenHash("confirm", confirmationToken);
    if (!hashesEqual(current.confirmationTokenHash, suppliedHash)) {
      throw new SuiteRepositoryError(
        "CONFIRMATION_INVALID",
        "The approval confirmation is invalid.",
      );
    }
    const now = this.#now();
    if (now.getTime() >= new Date(current.confirmationExpiresAt).getTime()) {
      throw new SuiteRepositoryError(
        "CONFIRMATION_EXPIRED",
        "The approval confirmation has expired. Request a new review challenge.",
      );
    }
    const registered = getSuite(current.candidateSuite.id);
    if (registered?.version === current.candidateSuite.version) {
      throw new SuiteRepositoryError(
        "SUITE_VERSION_EXISTS",
        `${current.candidateSuite.id}@${current.candidateSuite.version} is reserved by the built-in catalog.`,
      );
    }

    const capabilityToken = opaqueToken("suite");
    const publishedAt = now.toISOString();
    const storedSuite: StoredUnlistedSuite = {
      id: `suite-${randomUUID()}`,
      suiteId: current.candidateSuite.id,
      suiteVersion: current.candidateSuite.version,
      sourceDraftId: current.id,
      definition: clone(current.candidateSuite),
      publishedAt,
      capabilityTokenHash: tokenHash("suite", capabilityToken),
    };
    const next: StoredSuiteDraft = {
      ...current,
      status: "published",
      confirmationTokenHash: undefined,
      confirmationExpiresAt: undefined,
      publishedSuiteId: storedSuite.suiteId,
      publishedSuiteVersion: storedSuite.suiteVersion,
      publishedAt,
      updatedAt: publishedAt,
      revision: current.revision + 1,
    };
    const result = await this.#backend.publishDraft(
      next,
      current.revision,
      storedSuite,
    );
    if (result.kind === "version_conflict") {
      throw new SuiteRepositoryError(
        "SUITE_VERSION_EXISTS",
        `${storedSuite.suiteId}@${storedSuite.suiteVersion} is already published.`,
      );
    }
    if (result.kind === "stale") {
      throw new SuiteRepositoryError(
        "STALE_DRAFT",
        "The draft changed before approval could be committed.",
      );
    }
    return {
      draft: publicDraft(next),
      suite: publicSuite(storedSuite),
      capabilityToken,
    };
  }

  async rejectDraft(
    draftId: string,
    ownerToken: string,
  ): Promise<SuiteDraftRecord> {
    const current = await this.#ownedDraft(draftId, ownerToken);
    if (current.status === "published") {
      throw new SuiteRepositoryError(
        "DRAFT_ALREADY_PUBLISHED",
        "Published suites are immutable and cannot be rejected.",
      );
    }
    if (current.status === "rejected") return publicDraft(current);
    const now = this.#now().toISOString();
    const next: StoredSuiteDraft = {
      ...current,
      status: "rejected",
      candidateSuite: undefined,
      confirmationTokenHash: undefined,
      confirmationExpiresAt: undefined,
      updatedAt: now,
      revision: current.revision + 1,
    };
    if (!(await this.#backend.saveDraft(next, current.revision))) {
      throw new SuiteRepositoryError(
        "STALE_DRAFT",
        "The draft changed before rejection could be committed.",
      );
    }
    return publicDraft(next);
  }

  async resolveSuite(
    capabilityToken: string,
  ): Promise<UnlistedSuiteRecord | undefined> {
    const suite = await this.#backend.findSuiteByCapabilityHash(
      tokenHash("suite", capabilityToken),
    );
    return suite ? publicSuite(suite) : undefined;
  }

  /** Server/worker-only lookup after an API boundary has already authorized the capability. */
  async getSuiteInternal(
    suiteId: string,
    suiteVersion: string,
  ): Promise<UnlistedSuiteRecord | undefined> {
    const suite = await this.#backend.findSuiteByVersion(suiteId, suiteVersion);
    return suite ? publicSuite(suite) : undefined;
  }

  async #ownedDraft(
    draftId: string,
    ownerToken: string,
  ): Promise<StoredSuiteDraft> {
    const draft = await this.#backend.findDraft(
      draftId,
      tokenHash("owner", ownerToken),
    );
    if (!draft) {
      throw new SuiteRepositoryError(
        "DRAFT_NOT_FOUND",
        "Draft not found or owner capability is invalid.",
      );
    }
    return draft;
  }

  #assertDraftCanChange(draft: StoredSuiteDraft): void {
    if (draft.status === "published") {
      throw new SuiteRepositoryError(
        "DRAFT_ALREADY_PUBLISHED",
        "This draft has already published an immutable suite.",
      );
    }
    if (draft.status === "rejected") {
      throw new SuiteRepositoryError(
        "DRAFT_REJECTED",
        "This draft was rejected and cannot be published.",
      );
    }
  }
}

type SuiteRepositoryGlobals = typeof globalThis & {
  __callsmithInMemorySuiteBackend?: InMemorySuiteRepositoryBackend;
  __callsmithSuiteRepository?: SuiteRepository;
};

const repositoryGlobals = globalThis as SuiteRepositoryGlobals;

function defaultBackend(): SuiteRepositoryBackend {
  if (suitePersistenceConfigured()) return new PostgresSuiteRepositoryBackend();
  repositoryGlobals.__callsmithInMemorySuiteBackend ??=
    new InMemorySuiteRepositoryBackend();
  return repositoryGlobals.__callsmithInMemorySuiteBackend;
}

export const suiteRepository =
  repositoryGlobals.__callsmithSuiteRepository ??
  (repositoryGlobals.__callsmithSuiteRepository = new SuiteRepository(
    defaultBackend(),
  ));

export function resetSuiteRepositoryForTests(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Suite repository reset is available only in tests");
  }
  repositoryGlobals.__callsmithInMemorySuiteBackend?.clear();
}
