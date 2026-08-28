import postgres, { type Sql } from "postgres";

import {
  capabilityMatches,
  createCapabilityToken,
  hashCapabilityToken,
} from "@/lib/capabilities";
import {
  ContractProposalV1Schema,
  type ContractProposalV1,
} from "@/lib/contract-proposals";
import {
  SafetyContractDraftV1Schema,
  compileSafetyContract,
  type SafetyContractDraftV1,
} from "@/lib/safety-contract";

type ProposalGlobals = typeof globalThis & {
  __callsmithSql?: Sql;
  __callsmithProposalSchemaReady?: Promise<void>;
  __callsmithMemoryProposalRepository?: MemoryContractProposalRepository;
};
const proposalGlobals = globalThis as ProposalGlobals;

function databaseClient(): Sql | undefined {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return undefined;
  proposalGlobals.__callsmithSql ??= postgres(url, {
    max: 6,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  return proposalGlobals.__callsmithSql;
}

async function ensureSchema(sql: Sql): Promise<void> {
  proposalGlobals.__callsmithProposalSchemaReady ??= sql`
    CREATE TABLE IF NOT EXISTS callsmith_contract_proposals_v1 (
      id TEXT PRIMARY KEY,
      owner_token_hash TEXT NOT NULL UNIQUE,
      status_token_hash TEXT NOT NULL UNIQUE,
      decision_token_hash TEXT NOT NULL UNIQUE,
      draft JSONB NOT NULL,
      compiled_suite JSONB NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('awaiting_review', 'approved', 'rejected', 'expired')
      ),
      experiment_id TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `.then(() => undefined);
  await proposalGlobals.__callsmithProposalSchemaReady;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

interface ProposalRow {
  id: string;
  draft: unknown;
  compiledSuite: unknown;
  status: string;
  experimentId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  expiresAt: Date | string;
}

function mapRow(row: ProposalRow): ContractProposalV1 {
  return ContractProposalV1Schema.parse({
    schemaVersion: 1,
    id: row.id,
    draft: row.draft,
    compiledSuite: row.compiledSuite,
    status: row.status,
    ...(row.experimentId ? { experimentId: row.experimentId } : {}),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    expiresAt: iso(row.expiresAt),
  });
}

export type CreatedContractProposal = {
  proposal: ContractProposalV1;
  ownerToken: string;
  statusToken: string;
  decisionToken: string;
};

export interface ContractProposalRepository {
  create(draft: SafetyContractDraftV1): Promise<CreatedContractProposal>;
  getStatus(id: string, token: string): Promise<ContractProposalV1 | undefined>;
  getReview(id: string, token: string): Promise<ContractProposalV1 | undefined>;
  decide(
    id: string,
    token: string,
    decision: "approve" | "reject",
  ): Promise<ContractProposalV1>;
  attachExperiment(id: string, experimentId: string): Promise<ContractProposalV1>;
}

export class PostgresContractProposalRepository
  implements ContractProposalRepository
{
  constructor(private readonly sql: Sql) {}

  async create(draftInput: SafetyContractDraftV1): Promise<CreatedContractProposal> {
    await ensureSchema(this.sql);
    const draft = SafetyContractDraftV1Schema.parse(draftInput);
    const compiledSuite = compileSafetyContract(draft);
    const id = `proposal-${crypto.randomUUID()}`;
    const ownerToken = createCapabilityToken();
    const statusToken = createCapabilityToken();
    const decisionToken = createCapabilityToken();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 30 * 60_000);
    await this.sql`
      INSERT INTO callsmith_contract_proposals_v1 (
        id, owner_token_hash, status_token_hash, decision_token_hash,
        draft, compiled_suite, status, created_at, updated_at, expires_at
      ) VALUES (
        ${id}, ${hashCapabilityToken(ownerToken)}, ${hashCapabilityToken(statusToken)},
        ${hashCapabilityToken(decisionToken)}, ${this.sql.json(draft)},
        ${this.sql.json(compiledSuite)}, 'awaiting_review', ${createdAt.toISOString()},
        ${createdAt.toISOString()}, ${expiresAt.toISOString()}
      )
    `;
    const proposal = await this.getReview(id, ownerToken);
    if (!proposal) throw new Error("Contract proposal did not persist");
    return { proposal, ownerToken, statusToken, decisionToken };
  }

  private async find(
    id: string,
    tokenColumn: "owner_token_hash" | "status_token_hash" | "decision_token_hash",
    token: string,
  ): Promise<ContractProposalV1 | undefined> {
    await ensureSchema(this.sql);
    const tokenHash = hashCapabilityToken(token);
    const rows = tokenColumn === "owner_token_hash"
      ? await this.sql<ProposalRow[]>`
          SELECT id, draft, compiled_suite AS "compiledSuite", status,
            experiment_id AS "experimentId", created_at AS "createdAt",
            updated_at AS "updatedAt", expires_at AS "expiresAt"
          FROM callsmith_contract_proposals_v1
          WHERE id = ${id} AND owner_token_hash = ${tokenHash} LIMIT 1
        `
      : tokenColumn === "status_token_hash"
        ? await this.sql<ProposalRow[]>`
            SELECT id, draft, compiled_suite AS "compiledSuite", status,
              experiment_id AS "experimentId", created_at AS "createdAt",
              updated_at AS "updatedAt", expires_at AS "expiresAt"
            FROM callsmith_contract_proposals_v1
            WHERE id = ${id} AND status_token_hash = ${tokenHash} LIMIT 1
          `
        : await this.sql<ProposalRow[]>`
            SELECT id, draft, compiled_suite AS "compiledSuite", status,
              experiment_id AS "experimentId", created_at AS "createdAt",
              updated_at AS "updatedAt", expires_at AS "expiresAt"
            FROM callsmith_contract_proposals_v1
            WHERE id = ${id} AND decision_token_hash = ${tokenHash} LIMIT 1
          `;
    return rows[0] ? mapRow(rows[0]) : undefined;
  }

  getStatus(id: string, token: string) {
    return this.find(id, "status_token_hash", token);
  }

  getReview(id: string, token: string) {
    return this.find(id, "owner_token_hash", token);
  }

  async decide(id: string, token: string, decision: "approve" | "reject") {
    const current = await this.find(id, "decision_token_hash", token);
    if (!current) throw new Error("Contract proposal not found");
    if (current.status !== "awaiting_review") {
      throw new Error("This contract proposal has already been decided");
    }
    const expired = Date.parse(current.expiresAt) <= Date.now();
    const status = expired ? "expired" : decision === "approve" ? "approved" : "rejected";
    const rows = await this.sql<ProposalRow[]>`
      UPDATE callsmith_contract_proposals_v1 SET
        status = ${status}, updated_at = NOW()
      WHERE id = ${id} AND decision_token_hash = ${hashCapabilityToken(token)}
        AND status = 'awaiting_review'
      RETURNING id, draft, compiled_suite AS "compiledSuite", status,
        experiment_id AS "experimentId", created_at AS "createdAt",
        updated_at AS "updatedAt", expires_at AS "expiresAt"
    `;
    if (!rows[0]) throw new Error("This contract proposal was decided concurrently");
    const updated = mapRow(rows[0]);
    if (updated.status === "expired") throw new Error("This contract proposal expired before review");
    return updated;
  }

  async attachExperiment(id: string, experimentId: string) {
    const rows = await this.sql<ProposalRow[]>`
      UPDATE callsmith_contract_proposals_v1 SET
        experiment_id = ${experimentId}, updated_at = NOW()
      WHERE id = ${id} AND status = 'approved' AND experiment_id IS NULL
      RETURNING id, draft, compiled_suite AS "compiledSuite", status,
        experiment_id AS "experimentId", created_at AS "createdAt",
        updated_at AS "updatedAt", expires_at AS "expiresAt"
    `;
    if (!rows[0]) throw new Error("Approved proposal cannot attach another experiment");
    return mapRow(rows[0]);
  }
}

type MemoryProposal = {
  proposal: ContractProposalV1;
  ownerTokenHash: string;
  statusTokenHash: string;
  decisionTokenHash: string;
};

export class MemoryContractProposalRepository
  implements ContractProposalRepository
{
  private readonly proposals = new Map<string, MemoryProposal>();

  async create(draftInput: SafetyContractDraftV1): Promise<CreatedContractProposal> {
    const draft = SafetyContractDraftV1Schema.parse(draftInput);
    const ownerToken = createCapabilityToken();
    const statusToken = createCapabilityToken();
    const decisionToken = createCapabilityToken();
    const now = new Date();
    const proposal = ContractProposalV1Schema.parse({
      schemaVersion: 1,
      id: `proposal-${crypto.randomUUID()}`,
      draft,
      compiledSuite: compileSafetyContract(draft),
      status: "awaiting_review",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
    });
    this.proposals.set(proposal.id, {
      proposal,
      ownerTokenHash: hashCapabilityToken(ownerToken),
      statusTokenHash: hashCapabilityToken(statusToken),
      decisionTokenHash: hashCapabilityToken(decisionToken),
    });
    return { proposal: structuredClone(proposal), ownerToken, statusToken, decisionToken };
  }

  private find(id: string, token: string, kind: "owner" | "status" | "decision") {
    const stored = this.proposals.get(id);
    const expected = kind === "owner"
      ? stored?.ownerTokenHash
      : kind === "status"
        ? stored?.statusTokenHash
        : stored?.decisionTokenHash;
    return stored && expected && capabilityMatches(token, expected)
      ? structuredClone(stored.proposal)
      : undefined;
  }

  async getStatus(id: string, token: string) { return this.find(id, token, "status"); }
  async getReview(id: string, token: string) { return this.find(id, token, "owner"); }

  async decide(id: string, token: string, decision: "approve" | "reject") {
    const current = this.find(id, token, "decision");
    const stored = this.proposals.get(id);
    if (!current || !stored) throw new Error("Contract proposal not found");
    if (current.status !== "awaiting_review") throw new Error("This contract proposal has already been decided");
    if (Date.parse(current.expiresAt) <= Date.now()) {
      stored.proposal.status = "expired";
      throw new Error("This contract proposal expired before review");
    }
    stored.proposal.status = decision === "approve" ? "approved" : "rejected";
    stored.proposal.updatedAt = new Date().toISOString();
    return structuredClone(stored.proposal);
  }

  async attachExperiment(id: string, experimentId: string) {
    const stored = this.proposals.get(id);
    if (!stored || stored.proposal.status !== "approved" || stored.proposal.experimentId) {
      throw new Error("Approved proposal cannot attach another experiment");
    }
    stored.proposal.experimentId = experimentId;
    stored.proposal.updatedAt = new Date().toISOString();
    return structuredClone(stored.proposal);
  }
}

const sql = databaseClient();
export const contractProposalRepository: ContractProposalRepository = sql
  ? new PostgresContractProposalRepository(sql)
  : (proposalGlobals.__callsmithMemoryProposalRepository ??=
      new MemoryContractProposalRepository());
