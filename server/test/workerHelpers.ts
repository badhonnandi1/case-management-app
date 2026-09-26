import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

import type { AiAnswerRequestDto } from '../../shared/aiAnswerContract.js';
import { AI_CONSENT_VERSION } from '../../shared/aiAnswerContract.js';
import type { ProviderAnswerResult } from '../src/provider/provider.js';
import { sha256Base64Url } from '../src/worker/crypto.js';
import type { D1Database, D1PreparedStatement, D1Result, WorkerEnv } from '../src/worker/types.js';

export const TEST_INVITE_CODE = 'test-owner-invite-code-0000000000000000000000000001';
export const TEST_SIGNING_SECRET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export async function workerTestFixture(overrides: Partial<WorkerEnv> = {}) {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync(new URL('../migrations/0001_security.sql', import.meta.url), 'utf8'));
  const db = asD1(database);
  const now = Math.floor(Date.parse('2026-09-04T12:00:00.000Z') / 1_000);
  database.prepare(
    'INSERT INTO testers (id, label, code_hash, active, created_at) VALUES (?, ?, ?, 1, ?)',
  ).run('tester-owner-0001', 'Owner', await sha256Base64Url(TEST_INVITE_CODE), now);
  const env: WorkerEnv = {
    DB: db,
    GEMINI_API_KEY: 'fake-gemini-key',
    GROQ_API_KEY: 'fake-groq-key',
    SESSION_SIGNING_SECRET: TEST_SIGNING_SECRET,
    AI_ONLINE_ENABLED: 'true',
    AI_FALLBACK_ENABLED: 'true',
    AI_PUBLIC_MODEL_ID: 'balanced',
    AI_PUBLIC_MODEL_NAME: 'Balanced',
    GEMINI_DEFAULT_MODEL: 'gemini-test',
    GROQ_FALLBACK_MODEL: 'groq-test',
    AI_CONSENT_POLICY_VERSION: AI_CONSENT_VERSION,
    ANSWER_RATE_LIMIT_PER_MINUTE: '3',
    AI_DAILY_PER_TESTER_LIMIT: '10',
    AI_DAILY_GLOBAL_LIMIT: '50',
    AI_MAX_OUTPUT_TOKENS: '1024',
    SESSION_TTL_SECONDS: '900',
    PROVIDER_TIMEOUT_MS: '1000',
    ...overrides,
  };
  return { database, db, env };
}

export function workerRequest(overrides: Partial<AiAnswerRequestDto> = {}): AiAnswerRequestDto {
  return {
    requestId: 'request-0001',
    threadId: 'thread-0001',
    question: 'What date appears in the synthetic order?',
    selectedCaseIds: ['case-1'],
    selectedDocumentIds: ['document-1'],
    evidence: [{
      evidenceId: 'evidence-1',
      chunkId: 'chunk-1',
      caseId: 'case-1',
      documentId: 'document-1',
      documentName: 'Synthetic Order.pdf',
      pageStart: 2,
      pageEnd: 2,
      excerpt: 'The synthetic order is dated 12 September 2026.',
      localRank: 1,
    }],
    language: 'en',
    modelId: 'balanced',
    consent: { granted: true, version: AI_CONSENT_VERSION },
    ...overrides,
  };
}

export function providerSuccess(modelName = 'Balanced'): ProviderAnswerResult {
  return {
    answer: 'The order is dated 12 September 2026.',
    citations: [{
      evidenceId: 'evidence-1', chunkId: 'chunk-1', caseId: 'case-1', documentId: 'document-1',
      documentName: 'Synthetic Order.pdf', pageStart: 2, pageEnd: 2, citationNumber: 1,
      supportingStatement: null,
    }],
    insufficientEvidence: false,
    warnings: [],
    usage: { modelName, inputTokens: 20, outputTokens: 10, totalTokens: 30, durationMs: 5 },
  };
}

export async function issueWorkerSession(
  app: (request: Request, env: WorkerEnv) => Promise<Response>,
  env: WorkerEnv,
): Promise<string> {
  const response = await app(new Request('https://worker.test/api/v1/sessions', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inviteCode: TEST_INVITE_CODE }),
  }), env);
  if (response.status !== 201) throw new Error(`Session issue failed: ${response.status}`);
  return ((await response.json()) as { sessionToken: string }).sessionToken;
}

function asD1(database: DatabaseSync): D1Database {
  return {
    prepare(query: string) {
      return new NodeD1Statement(database.prepare(query));
    },
    async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results: D1Result[] = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

class NodeD1Statement implements D1PreparedStatement {
  private values: unknown[] = [];

  constructor(private readonly statement: StatementSync) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values;
    return this;
  }

  async first<Row>(): Promise<Row | null> {
    return (this.statement.get(...this.sqlValues()) as Row | undefined) ?? null;
  }

  async all<Row>(): Promise<D1Result<Row>> {
    return { success: true, results: this.statement.all(...this.sqlValues()) as Row[] };
  }

  async run<Row>(): Promise<D1Result<Row>> {
    const result = this.statement.run(...this.sqlValues());
    return { success: true, meta: { changes: Number(result.changes) } };
  }

  private sqlValues(): SQLInputValue[] {
    return this.values as SQLInputValue[];
  }
}
