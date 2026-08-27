import postgres, { type Sql } from "postgres";

import {
  JsonObjectSchema,
  SuiteDefinitionSchema,
} from "@/lib/contracts";
import type {
  PublishBackendResult,
  StoredSuiteDraft,
  StoredUnlistedSuite,
  SuiteDraftStatus,
  SuiteRepositoryBackend,
} from "@/lib/suite-repository";

type SuitePersistenceGlobals = typeof globalThis & {
  __callsmithSql?: Sql;
  __callsmithSuiteSchemaReady?: Promise<void>;
};

const persistenceGlobals = globalThis as SuitePersistenceGlobals;

function databaseUrl(): string | undefined {
  const value = process.env.DATABASE_URL?.trim();
  return value || undefined;
}

function client(): Sql | undefined {
  const url = databaseUrl();
  if (!url) return undefined;
  persistenceGlobals.__callsmithSql ??= postgres(url, {
    max: 4,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  return persistenceGlobals.__callsmithSql;
}

async function ensureSchema(sql: Sql): Promise<void> {
  persistenceGlobals.__callsmithSuiteSchemaReady ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS callsmith_suite_drafts (
        id TEXT PRIMARY KEY,
        owner_token_hash TEXT NOT NULL UNIQUE,
        draft JSONB NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('draft', 'awaiting_confirmation', 'published', 'rejected')
        ),
        candidate_suite JSONB,
        confirmation_token_hash TEXT UNIQUE,
        confirmation_expires_at TIMESTAMPTZ,
        published_suite_id TEXT,
        published_suite_version TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        published_at TIMESTAMPTZ,
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS callsmith_unlisted_suites (
        id TEXT PRIMARY KEY,
        suite_id TEXT NOT NULL,
        suite_version TEXT NOT NULL,
        source_draft_id TEXT NOT NULL UNIQUE
          REFERENCES callsmith_suite_drafts(id) ON DELETE RESTRICT,
        capability_token_hash TEXT NOT NULL UNIQUE,
        definition JSONB NOT NULL,
        published_at TIMESTAMPTZ NOT NULL,
        CONSTRAINT callsmith_unlisted_suite_version_unique
          UNIQUE (suite_id, suite_version)
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS callsmith_unlisted_suites_capability_idx
      ON callsmith_unlisted_suites (capability_token_hash)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS callsmith_unlisted_suites_version_idx
      ON callsmith_unlisted_suites (suite_id, suite_version)
    `;
    await sql`
      CREATE OR REPLACE FUNCTION callsmith_reject_unlisted_suite_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'callsmith unlisted suites are immutable';
      END;
      $$ LANGUAGE plpgsql
    `;
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = 'callsmith_unlisted_suites_immutable'
        ) THEN
          CREATE TRIGGER callsmith_unlisted_suites_immutable
          BEFORE UPDATE OR DELETE ON callsmith_unlisted_suites
          FOR EACH ROW EXECUTE FUNCTION callsmith_reject_unlisted_suite_mutation();
        END IF;
      END
      $$
    `;
  })();
  await persistenceGlobals.__callsmithSuiteSchemaReady;
}

export function suitePersistenceConfigured(): boolean {
  return Boolean(databaseUrl());
}

interface DraftRow {
  id: string;
  ownerTokenHash: string;
  draft: unknown;
  status: string;
  candidateSuite: unknown | null;
  confirmationTokenHash: string | null;
  confirmationExpiresAt: Date | string | null;
  publishedSuiteId: string | null;
  publishedSuiteVersion: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  publishedAt: Date | string | null;
  revision: number;
}

interface SuiteRow {
  id: string;
  suiteId: string;
  suiteVersion: string;
  sourceDraftId: string;
  capabilityTokenHash: string;
  definition: unknown;
  publishedAt: Date | string;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function mapDraft(row: DraftRow): StoredSuiteDraft {
  return {
    id: row.id,
    ownerTokenHash: row.ownerTokenHash,
    draft: JsonObjectSchema.parse(row.draft),
    status: row.status as SuiteDraftStatus,
    ...(row.candidateSuite
      ? { candidateSuite: SuiteDefinitionSchema.parse(row.candidateSuite) }
      : {}),
    ...(row.confirmationTokenHash
      ? { confirmationTokenHash: row.confirmationTokenHash }
      : {}),
    ...(row.confirmationExpiresAt
      ? { confirmationExpiresAt: iso(row.confirmationExpiresAt) }
      : {}),
    ...(row.publishedSuiteId
      ? { publishedSuiteId: row.publishedSuiteId }
      : {}),
    ...(row.publishedSuiteVersion
      ? { publishedSuiteVersion: row.publishedSuiteVersion }
      : {}),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    ...(row.publishedAt ? { publishedAt: iso(row.publishedAt) } : {}),
    revision: row.revision,
  };
}

function mapSuite(row: SuiteRow): StoredUnlistedSuite {
  return {
    id: row.id,
    suiteId: row.suiteId,
    suiteVersion: row.suiteVersion,
    sourceDraftId: row.sourceDraftId,
    capabilityTokenHash: row.capabilityTokenHash,
    definition: SuiteDefinitionSchema.parse(row.definition),
    publishedAt: iso(row.publishedAt),
  };
}

function postgresErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

class StaleDraftError extends Error {}

export class PostgresSuiteRepositoryBackend implements SuiteRepositoryBackend {
  readonly #sql: Sql;

  constructor(sql: Sql | undefined = client()) {
    if (!sql) {
      throw new Error("Postgres suite persistence requires DATABASE_URL");
    }
    this.#sql = sql;
  }

  async createDraft(record: StoredSuiteDraft): Promise<void> {
    await ensureSchema(this.#sql);
    await this.#sql`
      INSERT INTO callsmith_suite_drafts (
        id, owner_token_hash, draft, status, candidate_suite,
        confirmation_token_hash, confirmation_expires_at,
        published_suite_id, published_suite_version,
        created_at, updated_at, published_at, revision
      ) VALUES (
        ${record.id},
        ${record.ownerTokenHash},
        ${this.#sql.json(record.draft)},
        ${record.status},
        ${record.candidateSuite ? this.#sql.json(record.candidateSuite) : null},
        ${record.confirmationTokenHash ?? null},
        ${record.confirmationExpiresAt ?? null},
        ${record.publishedSuiteId ?? null},
        ${record.publishedSuiteVersion ?? null},
        ${record.createdAt},
        ${record.updatedAt},
        ${record.publishedAt ?? null},
        ${record.revision}
      )
    `;
  }

  async findDraft(
    id: string,
    ownerTokenHash: string,
  ): Promise<StoredSuiteDraft | undefined> {
    await ensureSchema(this.#sql);
    const rows = await this.#sql<DraftRow[]>`
      SELECT
        id,
        owner_token_hash AS "ownerTokenHash",
        draft,
        status,
        candidate_suite AS "candidateSuite",
        confirmation_token_hash AS "confirmationTokenHash",
        confirmation_expires_at AS "confirmationExpiresAt",
        published_suite_id AS "publishedSuiteId",
        published_suite_version AS "publishedSuiteVersion",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        published_at AS "publishedAt",
        revision
      FROM callsmith_suite_drafts
      WHERE id = ${id} AND owner_token_hash = ${ownerTokenHash}
      LIMIT 1
    `;
    return rows[0] ? mapDraft(rows[0]) : undefined;
  }

  async saveDraft(
    record: StoredSuiteDraft,
    expectedRevision: number,
  ): Promise<boolean> {
    await ensureSchema(this.#sql);
    const rows = await this.#sql<{ id: string }[]>`
      UPDATE callsmith_suite_drafts SET
        draft = ${this.#sql.json(record.draft)},
        status = ${record.status},
        candidate_suite = ${record.candidateSuite ? this.#sql.json(record.candidateSuite) : null},
        confirmation_token_hash = ${record.confirmationTokenHash ?? null},
        confirmation_expires_at = ${record.confirmationExpiresAt ?? null},
        published_suite_id = ${record.publishedSuiteId ?? null},
        published_suite_version = ${record.publishedSuiteVersion ?? null},
        updated_at = ${record.updatedAt},
        published_at = ${record.publishedAt ?? null},
        revision = ${record.revision}
      WHERE
        id = ${record.id}
        AND owner_token_hash = ${record.ownerTokenHash}
        AND revision = ${expectedRevision}
      RETURNING id
    `;
    return rows.length === 1;
  }

  async publishDraft(
    draft: StoredSuiteDraft,
    expectedRevision: number,
    suite: StoredUnlistedSuite,
  ): Promise<PublishBackendResult> {
    await ensureSchema(this.#sql);
    try {
      await this.#sql.begin(async (transaction) => {
        const updated = await transaction<{ id: string }[]>`
          UPDATE callsmith_suite_drafts SET
            status = ${draft.status},
            candidate_suite = ${draft.candidateSuite ? transaction.json(draft.candidateSuite) : null},
            confirmation_token_hash = NULL,
            confirmation_expires_at = NULL,
            published_suite_id = ${draft.publishedSuiteId ?? null},
            published_suite_version = ${draft.publishedSuiteVersion ?? null},
            updated_at = ${draft.updatedAt},
            published_at = ${draft.publishedAt ?? null},
            revision = ${draft.revision}
          WHERE
            id = ${draft.id}
            AND owner_token_hash = ${draft.ownerTokenHash}
            AND status = 'awaiting_confirmation'
            AND revision = ${expectedRevision}
          RETURNING id
        `;
        if (updated.length !== 1) throw new StaleDraftError();
        await transaction`
          INSERT INTO callsmith_unlisted_suites (
            id, suite_id, suite_version, source_draft_id,
            capability_token_hash, definition, published_at
          ) VALUES (
            ${suite.id},
            ${suite.suiteId},
            ${suite.suiteVersion},
            ${suite.sourceDraftId},
            ${suite.capabilityTokenHash},
            ${transaction.json(suite.definition)},
            ${suite.publishedAt}
          )
        `;
      });
      return { kind: "published" };
    } catch (error) {
      if (error instanceof StaleDraftError) return { kind: "stale" };
      if (postgresErrorCode(error) === "23505") {
        return { kind: "version_conflict" };
      }
      throw error;
    }
  }

  async findSuiteByCapabilityHash(
    capabilityTokenHash: string,
  ): Promise<StoredUnlistedSuite | undefined> {
    await ensureSchema(this.#sql);
    const rows = await this.#sql<SuiteRow[]>`
      SELECT
        id,
        suite_id AS "suiteId",
        suite_version AS "suiteVersion",
        source_draft_id AS "sourceDraftId",
        capability_token_hash AS "capabilityTokenHash",
        definition,
        published_at AS "publishedAt"
      FROM callsmith_unlisted_suites
      WHERE capability_token_hash = ${capabilityTokenHash}
      LIMIT 1
    `;
    return rows[0] ? mapSuite(rows[0]) : undefined;
  }

  async findSuiteByVersion(
    suiteId: string,
    suiteVersion: string,
  ): Promise<StoredUnlistedSuite | undefined> {
    await ensureSchema(this.#sql);
    const rows = await this.#sql<SuiteRow[]>`
      SELECT
        id,
        suite_id AS "suiteId",
        suite_version AS "suiteVersion",
        source_draft_id AS "sourceDraftId",
        capability_token_hash AS "capabilityTokenHash",
        definition,
        published_at AS "publishedAt"
      FROM callsmith_unlisted_suites
      WHERE suite_id = ${suiteId} AND suite_version = ${suiteVersion}
      LIMIT 1
    `;
    return rows[0] ? mapSuite(rows[0]) : undefined;
  }
}
