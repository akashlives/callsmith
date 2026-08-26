import postgres, { type Sql } from "postgres";

import { RunResultSchema, type RunResult } from "@/lib/contracts";

type PersistenceGlobals = typeof globalThis & {
  __callsmithSql?: Sql;
  __callsmithSchemaReady?: Promise<void>;
};

const persistenceGlobals = globalThis as PersistenceGlobals;

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
  persistenceGlobals.__callsmithSchemaReady ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS callsmith_runs (
        id TEXT PRIMARY KEY,
        share_token TEXT UNIQUE,
        run JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS callsmith_runs_share_token_idx
      ON callsmith_runs (share_token)
      WHERE share_token IS NOT NULL
    `;
  })();
  await persistenceGlobals.__callsmithSchemaReady;
}

export function persistenceConfigured(): boolean {
  return Boolean(databaseUrl());
}

export async function persistRun(run: RunResult): Promise<void> {
  const sql = client();
  if (!sql) return;
  await ensureSchema(sql);
  await sql`
    INSERT INTO callsmith_runs (id, share_token, run, updated_at)
    VALUES (
      ${run.id},
      ${run.shareToken ?? null},
      ${sql.json(run)},
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      share_token = EXCLUDED.share_token,
      run = EXCLUDED.run,
      updated_at = NOW()
  `;
}

export async function loadRun(id: string): Promise<RunResult | undefined> {
  const sql = client();
  if (!sql) return undefined;
  await ensureSchema(sql);
  const rows = await sql<{ run: unknown }[]>`
    SELECT run FROM callsmith_runs WHERE id = ${id} LIMIT 1
  `;
  return rows[0] ? RunResultSchema.parse(rows[0].run) : undefined;
}

export async function loadRunByShareToken(
  token: string,
): Promise<RunResult | undefined> {
  const sql = client();
  if (!sql) return undefined;
  await ensureSchema(sql);
  const rows = await sql<{ run: unknown }[]>`
    SELECT run FROM callsmith_runs WHERE share_token = ${token} LIMIT 1
  `;
  return rows[0] ? RunResultSchema.parse(rows[0].run) : undefined;
}
