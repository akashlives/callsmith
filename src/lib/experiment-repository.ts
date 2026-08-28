import postgres, { type Sql } from "postgres";

import { SuiteDefinitionV2Schema, type SuiteDefinitionV2 } from "@/lib/contracts";
import {
  capabilityMatches,
  createCapabilityToken,
  hashCapabilityToken,
} from "@/lib/capabilities";
import {
  EvidenceReceiptV1Schema,
  type EvidenceReceiptV1,
} from "@/lib/evidence-receipt";
import {
  CANONICAL_MODEL,
  ExperimentAttemptV1Schema,
  ExperimentRecordV1Schema,
  deriveExperimentEvidenceStatus,
  type ExperimentAttemptV1,
  type ExperimentRecordV1,
  type ExperimentStatus,
} from "@/lib/experiments";

type ExperimentGlobals = typeof globalThis & {
  __callsmithSql?: Sql;
  __callsmithExperimentSchemaReady?: Promise<void>;
  __callsmithMemoryExperimentRepository?: MemoryExperimentRepository;
};

const experimentGlobals = globalThis as ExperimentGlobals;

function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL?.trim() || undefined;
}

function databaseClient(): Sql | undefined {
  const url = databaseUrl();
  if (!url) return undefined;
  experimentGlobals.__callsmithSql ??= postgres(url, {
    max: 6,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  return experimentGlobals.__callsmithSql;
}

async function ensureSchema(sql: Sql): Promise<void> {
  experimentGlobals.__callsmithExperimentSchemaReady ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS callsmith_contracts_v1 (
        id TEXT NOT NULL,
        version TEXT NOT NULL,
        definition JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (id, version)
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS callsmith_experiments_v1 (
        id TEXT PRIMARY KEY,
        contract_id TEXT NOT NULL,
        contract_version TEXT NOT NULL,
        owner_token_hash TEXT NOT NULL UNIQUE,
        receipt_token_hash TEXT NOT NULL UNIQUE,
        model TEXT NOT NULL CHECK (model = 'gpt-5.6-luna'),
        seed INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('queued', 'running', 'completed', 'partial_failure', 'failed')
        ),
        evidence_status TEXT NOT NULL CHECK (
          evidence_status IN ('pending', 'conclusive', 'inconclusive', 'provider_failure')
        ),
        receipt_id TEXT UNIQUE,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        FOREIGN KEY (contract_id, contract_version)
          REFERENCES callsmith_contracts_v1(id, version) ON DELETE RESTRICT
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS callsmith_attempts_v1 (
        id TEXT PRIMARY KEY,
        experiment_id TEXT NOT NULL
          REFERENCES callsmith_experiments_v1(id) ON DELETE RESTRICT,
        model TEXT NOT NULL,
        seed INTEGER NOT NULL,
        contract_variant TEXT NOT NULL CHECK (contract_variant IN ('weak', 'hardened')),
        evidence JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (experiment_id, model, seed, contract_variant)
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS callsmith_experiment_outbox_v1 (
        experiment_id TEXT PRIMARY KEY
          REFERENCES callsmith_experiments_v1(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        dispatched_at TIMESTAMPTZ
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS callsmith_receipts_v1 (
        id TEXT PRIMARY KEY,
        experiment_id TEXT NOT NULL UNIQUE
          REFERENCES callsmith_experiments_v1(id) ON DELETE RESTRICT,
        token_hash TEXT NOT NULL UNIQUE,
        content_hash TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      )
    `;
    await sql`
      CREATE OR REPLACE FUNCTION callsmith_reject_receipt_v1_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Callsmith evidence receipts are immutable';
      END;
      $$ LANGUAGE plpgsql
    `;
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = 'callsmith_receipts_v1_immutable'
        ) THEN
          CREATE TRIGGER callsmith_receipts_v1_immutable
          BEFORE UPDATE OR DELETE ON callsmith_receipts_v1
          FOR EACH ROW EXECUTE FUNCTION callsmith_reject_receipt_v1_mutation();
        END IF;
      END
      $$
    `;
    await sql`
      CREATE OR REPLACE FUNCTION callsmith_reject_finalized_experiment_v1_mutation()
      RETURNS trigger AS $$
      BEGIN
        IF OLD.receipt_id IS NOT NULL THEN
          RAISE EXCEPTION 'Finalized Callsmith experiment is immutable';
        END IF;
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `;
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = 'callsmith_experiments_v1_finalized_immutable'
        ) THEN
          CREATE TRIGGER callsmith_experiments_v1_finalized_immutable
          BEFORE UPDATE OR DELETE ON callsmith_experiments_v1
          FOR EACH ROW EXECUTE FUNCTION callsmith_reject_finalized_experiment_v1_mutation();
        END IF;
      END
      $$
    `;
    await sql`
      CREATE OR REPLACE FUNCTION callsmith_reject_finalized_attempt_v1_mutation()
      RETURNS trigger AS $$
      DECLARE finalized_receipt TEXT;
      DECLARE target_experiment TEXT;
      BEGIN
        IF TG_OP = 'DELETE' THEN
          target_experiment := OLD.experiment_id;
        ELSE
          target_experiment := NEW.experiment_id;
        END IF;
        SELECT receipt_id INTO finalized_receipt
        FROM callsmith_experiments_v1
        WHERE id = target_experiment;
        IF finalized_receipt IS NOT NULL THEN
          RAISE EXCEPTION 'Finalized Callsmith experiment evidence is immutable';
        END IF;
        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `;
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = 'callsmith_attempts_v1_finalized_immutable'
        ) THEN
          CREATE TRIGGER callsmith_attempts_v1_finalized_immutable
          BEFORE INSERT OR UPDATE OR DELETE ON callsmith_attempts_v1
          FOR EACH ROW EXECUTE FUNCTION callsmith_reject_finalized_attempt_v1_mutation();
        END IF;
      END
      $$
    `;
  })();
  await experimentGlobals.__callsmithExperimentSchemaReady;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function canonical(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry && typeof entry === "object") {
      return Object.fromEntries(
        Object.entries(entry)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    return entry;
  };
  return JSON.stringify(normalize(value));
}

export interface CreatedExperiment {
  experiment: ExperimentRecordV1;
  accessToken: string;
  receiptToken: string;
}

export interface ExperimentRepository {
  create(suite: SuiteDefinitionV2): Promise<CreatedExperiment>;
  get(id: string, accessToken: string): Promise<ExperimentRecordV1 | undefined>;
  getInternal(id: string): Promise<ExperimentRecordV1 | undefined>;
  getSuite(id: string): Promise<SuiteDefinitionV2 | undefined>;
  pendingDispatch(limit?: number): Promise<string[]>;
  markDispatched(id: string): Promise<void>;
  addAttempt(id: string, attempt: ExperimentAttemptV1): Promise<boolean>;
  setStatus(id: string, status: ExperimentStatus): Promise<ExperimentRecordV1>;
  finalizeReceipt(id: string, receipt: EvidenceReceiptV1): Promise<void>;
  getReceipt(receiptToken: string): Promise<EvidenceReceiptV1 | undefined>;
}

interface ExperimentRow {
  id: string;
  contractId: string;
  contractVersion: string;
  model: string;
  seed: number;
  status: string;
  evidenceStatus: string;
  receiptId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

async function loadPostgresExperiment(
  sql: Sql,
  id: string,
  ownerTokenHash?: string,
): Promise<ExperimentRecordV1 | undefined> {
  const rows = ownerTokenHash
    ? await sql<ExperimentRow[]>`
        SELECT id, contract_id AS "contractId", contract_version AS "contractVersion",
          model, seed, status, evidence_status AS "evidenceStatus",
          receipt_id AS "receiptId", created_at AS "createdAt", updated_at AS "updatedAt"
        FROM callsmith_experiments_v1
        WHERE id = ${id} AND owner_token_hash = ${ownerTokenHash}
        LIMIT 1
      `
    : await sql<ExperimentRow[]>`
        SELECT id, contract_id AS "contractId", contract_version AS "contractVersion",
          model, seed, status, evidence_status AS "evidenceStatus",
          receipt_id AS "receiptId", created_at AS "createdAt", updated_at AS "updatedAt"
        FROM callsmith_experiments_v1
        WHERE id = ${id}
        LIMIT 1
      `;
  const row = rows[0];
  if (!row) return undefined;
  const attemptRows = await sql<{ evidence: unknown }[]>`
    SELECT evidence FROM callsmith_attempts_v1
    WHERE experiment_id = ${id}
    ORDER BY created_at, contract_variant
  `;
  return ExperimentRecordV1Schema.parse({
    schemaVersion: 1,
    id: row.id,
    contractId: row.contractId,
    contractVersion: row.contractVersion,
    model: row.model,
    seed: row.seed,
    status: row.status,
    evidenceStatus: row.evidenceStatus,
    attempts: attemptRows.map((attempt) => attempt.evidence),
    ...(row.receiptId ? { receiptId: row.receiptId } : {}),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });
}

export class PostgresExperimentRepository implements ExperimentRepository {
  constructor(private readonly sql: Sql) {}

  async create(suiteInput: SuiteDefinitionV2): Promise<CreatedExperiment> {
    const suite = SuiteDefinitionV2Schema.parse(suiteInput);
    await ensureSchema(this.sql);
    const id = `experiment-${crypto.randomUUID()}`;
    const accessToken = createCapabilityToken();
    const receiptToken = createCapabilityToken();
    const now = new Date().toISOString();

    await this.sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO callsmith_contracts_v1 (id, version, definition)
        VALUES (${suite.id}, ${suite.version}, ${transaction.json(suite)})
        ON CONFLICT (id, version) DO NOTHING
      `;
      const definitions = await transaction<{ definition: unknown }[]>`
        SELECT definition FROM callsmith_contracts_v1
        WHERE id = ${suite.id} AND version = ${suite.version}
        LIMIT 1
      `;
      if (!definitions[0] || canonical(definitions[0].definition) !== canonical(suite)) {
        throw new Error("An immutable contract version already exists with different content");
      }
      await transaction`
        INSERT INTO callsmith_experiments_v1 (
          id, contract_id, contract_version, owner_token_hash,
          receipt_token_hash, model, seed, status, evidence_status,
          created_at, updated_at
        ) VALUES (
          ${id}, ${suite.id}, ${suite.version}, ${hashCapabilityToken(accessToken)},
          ${hashCapabilityToken(receiptToken)}, ${CANONICAL_MODEL},
          ${suite.scenarios[0].seed}, 'queued', 'pending', ${now}, ${now}
        )
      `;
      await transaction`
        INSERT INTO callsmith_experiment_outbox_v1 (experiment_id)
        VALUES (${id})
      `;
    });
    const experiment = await this.getInternal(id);
    if (!experiment) throw new Error("Experiment creation did not persist");
    return { experiment, accessToken, receiptToken };
  }

  async get(id: string, accessToken: string) {
    await ensureSchema(this.sql);
    return loadPostgresExperiment(this.sql, id, hashCapabilityToken(accessToken));
  }

  async getInternal(id: string) {
    await ensureSchema(this.sql);
    return loadPostgresExperiment(this.sql, id);
  }

  async getSuite(id: string): Promise<SuiteDefinitionV2 | undefined> {
    await ensureSchema(this.sql);
    const rows = await this.sql<{ definition: unknown }[]>`
      SELECT contract.definition
      FROM callsmith_experiments_v1 experiment
      JOIN callsmith_contracts_v1 contract
        ON contract.id = experiment.contract_id
        AND contract.version = experiment.contract_version
      WHERE experiment.id = ${id}
      LIMIT 1
    `;
    return rows[0] ? SuiteDefinitionV2Schema.parse(rows[0].definition) : undefined;
  }

  async pendingDispatch(limit = 20): Promise<string[]> {
    await ensureSchema(this.sql);
    const rows = await this.sql<{ experimentId: string }[]>`
      SELECT outbox.experiment_id AS "experimentId"
      FROM callsmith_experiment_outbox_v1 outbox
      JOIN callsmith_experiments_v1 experiment
        ON experiment.id = outbox.experiment_id
      WHERE outbox.dispatched_at IS NULL
        AND experiment.status IN ('queued', 'running')
      ORDER BY outbox.created_at
      LIMIT ${Math.max(1, Math.min(100, limit))}
    `;
    return rows.map((row) => row.experimentId);
  }

  async markDispatched(id: string): Promise<void> {
    await ensureSchema(this.sql);
    await this.sql`
      UPDATE callsmith_experiment_outbox_v1
      SET dispatched_at = COALESCE(dispatched_at, NOW())
      WHERE experiment_id = ${id}
    `;
  }

  async addAttempt(id: string, attemptInput: ExperimentAttemptV1): Promise<boolean> {
    await ensureSchema(this.sql);
    const attempt = ExperimentAttemptV1Schema.parse(attemptInput);
    const experiment = await this.getInternal(id);
    if (!experiment) throw new Error(`Unknown experiment \"${id}\"`);
    if (experiment.receiptId) {
      throw new Error("Finalized experiment evidence cannot accept another attempt");
    }
    if (
      attempt.status === "completed" &&
      attempt.execution.model !== experiment.model
    ) {
      throw new Error("Attempt model does not match the experiment model");
    }
    if (attempt.status === "provider_failure" && attempt.seed !== experiment.seed) {
      throw new Error("Attempt seed does not match the experiment seed");
    }
    const rows = await this.sql<{ id: string }[]>`
      INSERT INTO callsmith_attempts_v1 (
        id, experiment_id, model, seed, contract_variant, evidence
      ) VALUES (
        ${attempt.attemptId}, ${id}, ${experiment.model}, ${experiment.seed},
        ${attempt.contractVariant}, ${this.sql.json(attempt)}
      )
      ON CONFLICT (experiment_id, model, seed, contract_variant) DO NOTHING
      RETURNING id
    `;
    if (rows.length) {
      await this.sql`
        UPDATE callsmith_experiments_v1 SET updated_at = NOW()
        WHERE id = ${id}
      `;
    }
    return rows.length === 1;
  }

  async setStatus(id: string, status: ExperimentStatus): Promise<ExperimentRecordV1> {
    const current = await this.getInternal(id);
    if (!current) throw new Error(`Unknown experiment \"${id}\"`);
    if (current.receiptId) {
      if (current.status === status) return current;
      throw new Error("Finalized experiment status cannot be changed");
    }
    const evidenceStatus = deriveExperimentEvidenceStatus({
      status,
      attempts: current.attempts,
    });
    await this.sql`
      UPDATE callsmith_experiments_v1 SET
        status = ${status}, evidence_status = ${evidenceStatus}, updated_at = NOW()
      WHERE id = ${id}
    `;
    const updated = await this.getInternal(id);
    if (!updated) throw new Error(`Experiment \"${id}\" disappeared after update`);
    return updated;
  }

  async finalizeReceipt(id: string, receiptInput: EvidenceReceiptV1): Promise<void> {
    await ensureSchema(this.sql);
    const receipt = EvidenceReceiptV1Schema.parse(receiptInput);
    if (receipt.experimentId !== id) {
      throw new Error("Evidence receipt does not belong to this experiment");
    }
    await this.sql.begin(async (transaction) => {
      const rows = await transaction<{
        receiptId: string | null;
        receiptTokenHash: string;
        evidenceStatus: string;
      }[]>`
        SELECT receipt_id AS "receiptId", receipt_token_hash AS "receiptTokenHash",
          evidence_status AS "evidenceStatus"
        FROM callsmith_experiments_v1
        WHERE id = ${id}
        FOR UPDATE
      `;
      const experiment = rows[0];
      if (!experiment) throw new Error(`Unknown experiment \"${id}\"`);
      if (experiment.receiptId) {
        const existing = await transaction<{ payload: unknown }[]>`
          SELECT payload FROM callsmith_receipts_v1 WHERE id = ${experiment.receiptId}
        `;
        if (
          !existing[0] ||
          canonical(existing[0].payload) !== canonical(receipt)
        ) {
          throw new Error("Finalized evidence receipts cannot be changed");
        }
        return;
      }
      if (experiment.evidenceStatus !== "conclusive") {
        throw new Error("Only conclusive experiments can finalize an evidence receipt");
      }
      await transaction`
        INSERT INTO callsmith_receipts_v1 (
          id, experiment_id, token_hash, content_hash, payload, created_at
        ) VALUES (
          ${receipt.receiptId}, ${id}, ${experiment.receiptTokenHash},
          ${receipt.contentHash}, ${transaction.json(receipt)}, ${receipt.finalizedAt}
        )
      `;
      await transaction`
        UPDATE callsmith_experiments_v1
        SET receipt_id = ${receipt.receiptId}, updated_at = NOW()
        WHERE id = ${id}
      `;
    });
  }

  async getReceipt(receiptToken: string): Promise<EvidenceReceiptV1 | undefined> {
    await ensureSchema(this.sql);
    const rows = await this.sql<{ payload: unknown }[]>`
      SELECT payload FROM callsmith_receipts_v1
      WHERE token_hash = ${hashCapabilityToken(receiptToken)}
      LIMIT 1
    `;
    return rows[0] ? EvidenceReceiptV1Schema.parse(rows[0].payload) : undefined;
  }
}

type MemoryExperiment = {
  record: ExperimentRecordV1;
  suite: SuiteDefinitionV2;
  ownerTokenHash: string;
  receiptTokenHash: string;
  receipt?: EvidenceReceiptV1;
  dispatched: boolean;
};

export class MemoryExperimentRepository implements ExperimentRepository {
  private readonly records = new Map<string, MemoryExperiment>();

  async create(suiteInput: SuiteDefinitionV2): Promise<CreatedExperiment> {
    const suite = SuiteDefinitionV2Schema.parse(suiteInput);
    const id = `experiment-${crypto.randomUUID()}`;
    const accessToken = createCapabilityToken();
    const receiptToken = createCapabilityToken();
    const now = new Date().toISOString();
    const record = ExperimentRecordV1Schema.parse({
      schemaVersion: 1,
      id,
      contractId: suite.id,
      contractVersion: suite.version,
      model: CANONICAL_MODEL,
      seed: suite.scenarios[0].seed,
      status: "queued",
      evidenceStatus: "pending",
      attempts: [],
      createdAt: now,
      updatedAt: now,
    });
    this.records.set(id, {
      record,
      suite: structuredClone(suite),
      ownerTokenHash: hashCapabilityToken(accessToken),
      receiptTokenHash: hashCapabilityToken(receiptToken),
      dispatched: false,
    });
    return { experiment: structuredClone(record), accessToken, receiptToken };
  }

  async get(id: string, accessToken: string) {
    const stored = this.records.get(id);
    return stored && capabilityMatches(accessToken, stored.ownerTokenHash)
      ? structuredClone(stored.record)
      : undefined;
  }

  async getInternal(id: string) {
    const stored = this.records.get(id);
    return stored ? structuredClone(stored.record) : undefined;
  }

  async getSuite(id: string) {
    const stored = this.records.get(id);
    return stored ? structuredClone(stored.suite) : undefined;
  }

  async pendingDispatch(limit = 20) {
    return [...this.records.values()]
      .filter(
        (stored) =>
          !stored.dispatched &&
          ["queued", "running"].includes(stored.record.status),
      )
      .slice(0, Math.max(1, Math.min(100, limit)))
      .map((stored) => stored.record.id);
  }

  async markDispatched(id: string) {
    const stored = this.records.get(id);
    if (!stored) throw new Error(`Unknown experiment \"${id}\"`);
    stored.dispatched = true;
  }

  async addAttempt(id: string, attemptInput: ExperimentAttemptV1): Promise<boolean> {
    const stored = this.records.get(id);
    if (!stored) throw new Error(`Unknown experiment \"${id}\"`);
    if (stored.record.receiptId) {
      throw new Error("Finalized experiment evidence cannot accept another attempt");
    }
    const attempt = ExperimentAttemptV1Schema.parse(attemptInput);
    if (
      stored.record.attempts.some(
        (item) => item.contractVariant === attempt.contractVariant,
      )
    ) {
      return false;
    }
    stored.record.attempts.push(structuredClone(attempt));
    stored.record.updatedAt = new Date().toISOString();
    return true;
  }

  async setStatus(id: string, status: ExperimentStatus) {
    const stored = this.records.get(id);
    if (!stored) throw new Error(`Unknown experiment \"${id}\"`);
    if (stored.record.receiptId) {
      if (stored.record.status === status) return structuredClone(stored.record);
      throw new Error("Finalized experiment status cannot be changed");
    }
    stored.record.status = status;
    stored.record.evidenceStatus = deriveExperimentEvidenceStatus({
      status,
      attempts: stored.record.attempts,
    });
    stored.record.updatedAt = new Date().toISOString();
    return structuredClone(stored.record);
  }

  async finalizeReceipt(id: string, receiptInput: EvidenceReceiptV1): Promise<void> {
    const stored = this.records.get(id);
    if (!stored) throw new Error(`Unknown experiment \"${id}\"`);
    const receipt = EvidenceReceiptV1Schema.parse(receiptInput);
    if (receipt.experimentId !== id) {
      throw new Error("Evidence receipt does not belong to this experiment");
    }
    if (stored.receipt) {
      if (canonical(stored.receipt) !== canonical(receipt)) {
        throw new Error("Finalized evidence receipts cannot be changed");
      }
      return;
    }
    if (stored.record.evidenceStatus !== "conclusive") {
      throw new Error("Only conclusive experiments can finalize an evidence receipt");
    }
    stored.receipt = structuredClone(receipt);
    stored.record.receiptId = receipt.receiptId;
  }

  async getReceipt(receiptToken: string) {
    for (const stored of this.records.values()) {
      if (capabilityMatches(receiptToken, stored.receiptTokenHash) && stored.receipt) {
        return structuredClone(stored.receipt);
      }
    }
    return undefined;
  }
}

export function experimentPersistenceConfigured(): boolean {
  return Boolean(databaseUrl());
}

const sql = databaseClient();
export const experimentRepository: ExperimentRepository = sql
  ? new PostgresExperimentRepository(sql)
  : (experimentGlobals.__callsmithMemoryExperimentRepository ??=
      new MemoryExperimentRepository());
