import type { WorkerConfig } from './config.js';
import type { D1Database } from './types.js';

export interface TesterRecord {
  id: string;
  label: string;
}

export interface SessionRecord {
  id: string;
  testerId: string;
  expiresAt: number;
}

export type AnswerReservationFailure = 'REPLAY' | 'UNAUTHORIZED' | 'MINUTE' | 'TESTER_DAY' | 'GLOBAL_DAY';

export class AnswerReservationError extends Error {
  constructor(readonly reason: AnswerReservationFailure) {
    super(reason);
    this.name = 'AnswerReservationError';
  }
}

export class WorkerSecurityStore {
  constructor(private readonly database: D1Database) {}

  async findActiveTesterByCodeHash(codeHash: string): Promise<TesterRecord | null> {
    const row = await this.database.prepare(
      `SELECT id, label FROM testers
       WHERE code_hash = ? AND active = 1 AND revoked_at IS NULL`,
    ).bind(codeHash).first<{ id: string; label: string }>();
    return row ? { id: row.id, label: row.label } : null;
  }

  async createSession(testerId: string, nowSeconds: number, ttlSeconds: number): Promise<SessionRecord> {
    const session: SessionRecord = {
      id: crypto.randomUUID(),
      testerId,
      expiresAt: nowSeconds + ttlSeconds,
    };
    await this.database.prepare(
      `INSERT INTO sessions (id, tester_id, created_at, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, NULL)`,
    ).bind(session.id, session.testerId, nowSeconds, session.expiresAt).run();
    return session;
  }

  async getActiveSession(sessionId: string, testerId: string, nowSeconds: number): Promise<SessionRecord | null> {
    const row = await this.database.prepare(
      `SELECT sessions.id, sessions.tester_id, sessions.expires_at
       FROM sessions
       JOIN testers ON testers.id = sessions.tester_id
       WHERE sessions.id = ? AND sessions.tester_id = ?
         AND sessions.revoked_at IS NULL AND sessions.expires_at > ?
         AND testers.active = 1 AND testers.revoked_at IS NULL`,
    ).bind(sessionId, testerId, nowSeconds).first<{
      id: string;
      tester_id: string;
      expires_at: number;
    }>();
    return row ? { id: row.id, testerId: row.tester_id, expiresAt: row.expires_at } : null;
  }

  async findReplay(sessionId: string, requestId: string): Promise<{ fingerprint: string } | null> {
    return this.database.prepare(
      'SELECT fingerprint FROM answer_reservations WHERE session_id = ? AND request_id = ?',
    ).bind(sessionId, requestId).first<{ fingerprint: string }>();
  }

  async reserveAnswer(input: {
    sessionId: string;
    testerId: string;
    requestId: string;
    fingerprint: string;
    now: Date;
    config: WorkerConfig;
  }): Promise<void> {
    const existing = await this.findReplay(input.sessionId, input.requestId);
    if (existing) throw new AnswerReservationError('REPLAY');
    const nowSeconds = Math.floor(input.now.getTime() / 1_000);
    const minuteBucket = input.now.toISOString().slice(0, 16);
    const dayBucket = input.now.toISOString().slice(0, 10);
    const reservationId = crypto.randomUUID();
    try {
      const results = await this.database.batch([
        this.database.prepare(
        `INSERT INTO answer_reservations (
          id, session_id, tester_id, request_id, fingerprint, minute_bucket,
          day_bucket, minute_limit, tester_day_limit, global_day_limit,
          created_at, expires_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM sessions
          JOIN testers ON testers.id = sessions.tester_id
          WHERE sessions.id = ? AND sessions.tester_id = ?
            AND sessions.revoked_at IS NULL AND sessions.expires_at > ?
            AND testers.active = 1 AND testers.revoked_at IS NULL
        )
        AND COALESCE((SELECT count FROM usage_counters
          WHERE scope = 'tester_minute' AND subject_id = ? AND bucket = ?), 0) < ?
        AND COALESCE((SELECT count FROM usage_counters
          WHERE scope = 'tester_day' AND subject_id = ? AND bucket = ?), 0) < ?
        AND COALESCE((SELECT count FROM usage_counters
          WHERE scope = 'global_day' AND subject_id = 'global' AND bucket = ?), 0) < ?`,
        ).bind(
          reservationId, input.sessionId, input.testerId, input.requestId,
          input.fingerprint, minuteBucket, dayBucket, input.config.answerRateLimitPerMinute,
          input.config.dailyPerTesterLimit, input.config.dailyGlobalLimit,
          nowSeconds, nowSeconds + 86_400,
          input.sessionId, input.testerId, nowSeconds,
          input.testerId, minuteBucket, input.config.answerRateLimitPerMinute,
          input.testerId, dayBucket, input.config.dailyPerTesterLimit,
          dayBucket, input.config.dailyGlobalLimit,
        ),
        counterStatement(this.database, reservationId, 'tester_minute', input.testerId, minuteBucket, nowSeconds),
        counterStatement(this.database, reservationId, 'tester_day', input.testerId, dayBucket, nowSeconds),
        counterStatement(this.database, reservationId, 'global_day', 'global', dayBucket, nowSeconds),
      ]);
      if ((results[0]?.meta?.changes ?? 0) === 0) {
        throw await this.classifyDeniedReservation(
          input.sessionId, input.testerId, nowSeconds, minuteBucket, dayBucket, input.config,
        );
      }
    } catch (error) {
      if (error instanceof AnswerReservationError) throw error;
      throw classifyReservationError(error);
    }
  }

  private async classifyDeniedReservation(
    sessionId: string,
    testerId: string,
    nowSeconds: number,
    minuteBucket: string,
    dayBucket: string,
    config: WorkerConfig,
  ): Promise<AnswerReservationError> {
    const row = await this.database.prepare(
      `SELECT
        EXISTS (
          SELECT 1 FROM sessions JOIN testers ON testers.id = sessions.tester_id
          WHERE sessions.id = ? AND sessions.tester_id = ?
            AND sessions.revoked_at IS NULL AND sessions.expires_at > ?
            AND testers.active = 1 AND testers.revoked_at IS NULL
        ) AS authorized,
        COALESCE((SELECT count FROM usage_counters
          WHERE scope = 'tester_minute' AND subject_id = ? AND bucket = ?), 0) AS minute_count,
        COALESCE((SELECT count FROM usage_counters
          WHERE scope = 'tester_day' AND subject_id = ? AND bucket = ?), 0) AS tester_day_count,
        COALESCE((SELECT count FROM usage_counters
          WHERE scope = 'global_day' AND subject_id = 'global' AND bucket = ?), 0) AS global_day_count`,
    ).bind(
      sessionId, testerId, nowSeconds,
      testerId, minuteBucket,
      testerId, dayBucket,
      dayBucket,
    ).first<{
      authorized: number;
      minute_count: number;
      tester_day_count: number;
      global_day_count: number;
    }>();
    if (!row?.authorized) return new AnswerReservationError('UNAUTHORIZED');
    if (row.minute_count >= config.answerRateLimitPerMinute) return new AnswerReservationError('MINUTE');
    if (row.tester_day_count >= config.dailyPerTesterLimit) return new AnswerReservationError('TESTER_DAY');
    if (row.global_day_count >= config.dailyGlobalLimit) return new AnswerReservationError('GLOBAL_DAY');
    return new AnswerReservationError('GLOBAL_DAY');
  }

  async isCircuitOpen(provider: 'gemini' | 'groq', nowSeconds: number): Promise<boolean> {
    const row = await this.database.prepare(
      'SELECT open_until FROM provider_circuits WHERE provider = ?',
    ).bind(provider).first<{ open_until: number }>();
    return (row?.open_until ?? 0) > nowSeconds;
  }

  async recordProviderSuccess(provider: 'gemini' | 'groq', nowSeconds: number): Promise<void> {
    await this.database.prepare(
      `INSERT INTO provider_circuits (provider, consecutive_failures, open_until, updated_at)
       VALUES (?, 0, 0, ?)
       ON CONFLICT(provider) DO UPDATE SET consecutive_failures = 0, open_until = 0, updated_at = excluded.updated_at`,
    ).bind(provider, nowSeconds).run();
  }

  async recordRetryableProviderFailure(input: {
    provider: 'gemini' | 'groq';
    nowSeconds: number;
    retryAfterSeconds: number | null;
    threshold: number;
    openSeconds: number;
  }): Promise<void> {
    const current = await this.database.prepare(
      'SELECT consecutive_failures FROM provider_circuits WHERE provider = ?',
    ).bind(input.provider).first<{ consecutive_failures: number }>();
    const failures = (current?.consecutive_failures ?? 0) + 1;
    const requestedOpenSeconds = Math.min(120, Math.max(0, input.retryAfterSeconds ?? 0));
    const openFor = requestedOpenSeconds > 0
      ? Math.max(input.openSeconds, requestedOpenSeconds)
      : failures >= input.threshold ? input.openSeconds : 0;
    await this.database.prepare(
      `INSERT INTO provider_circuits (provider, consecutive_failures, open_until, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET
         consecutive_failures = excluded.consecutive_failures,
         open_until = excluded.open_until,
         updated_at = excluded.updated_at`,
    ).bind(input.provider, failures, openFor > 0 ? input.nowSeconds + openFor : 0, input.nowSeconds).run();
  }
}

function counterStatement(
  database: D1Database,
  reservationId: string,
  scope: 'tester_minute' | 'tester_day' | 'global_day',
  subjectId: string,
  bucket: string,
  nowSeconds: number,
) {
  return database.prepare(
    `INSERT INTO usage_counters (scope, subject_id, bucket, count, updated_at)
     SELECT ?, ?, ?, 1, ?
     WHERE EXISTS (SELECT 1 FROM answer_reservations WHERE id = ?)
     ON CONFLICT(scope, subject_id, bucket)
     DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`,
  ).bind(scope, subjectId, bucket, nowSeconds, reservationId);
}

function classifyReservationError(error: unknown): AnswerReservationError {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes('RATE_TESTER_MINUTE')) return new AnswerReservationError('MINUTE');
  if (text.includes('RATE_TESTER_DAY')) return new AnswerReservationError('TESTER_DAY');
  if (text.includes('RATE_GLOBAL_DAY')) return new AnswerReservationError('GLOBAL_DAY');
  if (text.includes('AUTH_INVALID')) return new AnswerReservationError('UNAUTHORIZED');
  if (text.includes('UNIQUE constraint failed: answer_reservations.session_id')) {
    return new AnswerReservationError('REPLAY');
  }
  throw error;
}
