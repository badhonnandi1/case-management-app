import assert from 'node:assert/strict';
import test from 'node:test';

import { createWorkerApp, type ProviderRouterLike } from '../src/worker/app.js';
import type { WorkerOperationalLogEvent } from '../src/worker/types.js';
import {
  issueWorkerSession,
  providerSuccess,
  TEST_INVITE_CODE,
  workerRequest,
  workerTestFixture,
} from './workerHelpers.js';

const fixedNow = new Date('2026-09-04T12:00:00.000Z');

test('health and config are safe, provider-neutral, and advertise fixed free limits', async () => {
  const { env } = await workerTestFixture();
  const app = createWorkerApp({ now: () => fixedNow });
  const health = await app(new Request('https://worker.test/health'), env);
  assert.deepEqual(await health.json(), { status: 'ok', apiVersion: 'v1', onlineAnswers: 'available' });
  const response = await app(new Request('https://worker.test/api/v1/config'), env);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 200);
  assert.equal(body.providerDisplayName, 'Case Management AI');
  assert.equal(body.defaultModelId, 'balanced');
  assert.doesNotMatch(JSON.stringify(body), /gemini-test|groq-test|fake-.*-key|SESSION_SIGNING_SECRET/i);
  assert.deepEqual(body.limits, {
    questionCharacters: 2000, evidenceItems: 8, requestsPerMinute: 3,
    requestsPerDay: 10, globalRequestsPerDay: 50, maxOutputTokens: 1024,
  });
});

test('tester authentication rejects missing, inactive, and invalid invite codes', async () => {
  const { env, database } = await workerTestFixture();
  const app = createWorkerApp({ now: () => fixedNow });
  for (const code of ['', 'invalid-invite-code-that-is-long-enough-000000000000000000']) {
    const response = await app(new Request('https://worker.test/api/v1/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inviteCode: code }),
    }), env);
    assert.equal(response.status, 401);
  }
  database.exec("UPDATE testers SET active = 0 WHERE label = 'Owner'");
  const inactive = await app(new Request('https://worker.test/api/v1/sessions', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inviteCode: TEST_INVITE_CODE }),
  }), env);
  assert.equal(inactive.status, 401);
});

test('valid invite creates a session and a valid answer resolves without storing content', async () => {
  const { env, database } = await workerTestFixture();
  let calls = 0;
  const app = createWorkerApp({
    now: () => fixedNow,
    routerFactory: () => successRouter(() => { calls += 1; }),
  });
  const token = await issueWorkerSession(app, env);
  const response = await answer(app, env, token, workerRequest());
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  const body = await response.json() as { usage: { modelName: string }; citations: unknown[] };
  assert.equal(body.usage.modelName, 'Balanced');
  assert.equal(body.citations.length, 1);
  const schema = database.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table'").all() as Array<{ sql: string }>;
  assert.doesNotMatch(JSON.stringify(schema), /question|excerpt|prompt|response|answer_text|case_metadata/i);
});

test('expired and revoked sessions fail before provider use', async () => {
  for (const mode of ['expired', 'revoked'] as const) {
    const { env, database } = await workerTestFixture();
    let calls = 0;
    const issueApp = createWorkerApp({ now: () => fixedNow });
    const token = await issueWorkerSession(issueApp, env);
    if (mode === 'revoked') database.exec('UPDATE sessions SET revoked_at = 1');
    const useNow = mode === 'expired' ? new Date(fixedNow.getTime() + 901_000) : fixedNow;
    const app = createWorkerApp({
      now: () => useNow,
      routerFactory: () => successRouter(() => { calls += 1; }),
    });
    const response = await answer(app, env, token, workerRequest());
    assert.equal(response.status, 401, mode);
    assert.equal(calls, 0, mode);
  }
});

test('replay attempts fail closed and never call a provider twice', async () => {
  const { env } = await workerTestFixture();
  let calls = 0;
  const app = createWorkerApp({ now: () => fixedNow, routerFactory: () => successRouter(() => { calls += 1; }) });
  const token = await issueWorkerSession(app, env);
  assert.equal((await answer(app, env, token, workerRequest())).status, 200);
  const replay = await answer(app, env, token, workerRequest());
  assert.equal(replay.status, 409);
  assert.equal(((await replay.json()) as { error: { code: string } }).error.code, 'INVALID_REQUEST');
  assert.equal(calls, 1);
});

test('D1 batch atomically enforces per-tester minute limit', async () => {
  const { env } = await workerTestFixture({ ANSWER_RATE_LIMIT_PER_MINUTE: '2' });
  const app = createWorkerApp({ now: () => fixedNow, routerFactory: () => successRouter() });
  const token = await issueWorkerSession(app, env);
  assert.equal((await answer(app, env, token, workerRequest({ requestId: 'minute-1' }))).status, 200);
  assert.equal((await answer(app, env, token, workerRequest({ requestId: 'minute-2' }))).status, 200);
  const limited = await answer(app, env, token, workerRequest({ requestId: 'minute-3' }));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
});

test('D1 batch enforces per-tester daily limit across minute buckets', async () => {
  const { env } = await workerTestFixture({ ANSWER_RATE_LIMIT_PER_MINUTE: '60', AI_DAILY_PER_TESTER_LIMIT: '2' });
  let current = fixedNow;
  const app = createWorkerApp({ now: () => current, routerFactory: () => successRouter() });
  const token = await issueWorkerSession(app, env);
  assert.equal((await answer(app, env, token, workerRequest({ requestId: 'day-1' }))).status, 200);
  current = new Date(fixedNow.getTime() + 61_000);
  assert.equal((await answer(app, env, token, workerRequest({ requestId: 'day-2' }))).status, 200);
  current = new Date(fixedNow.getTime() + 122_000);
  assert.equal((await answer(app, env, token, workerRequest({ requestId: 'day-3' }))).status, 429);
});

test('D1 batch enforces global daily cutoff', async () => {
  const { env } = await workerTestFixture({
    ANSWER_RATE_LIMIT_PER_MINUTE: '60', AI_DAILY_PER_TESTER_LIMIT: '10', AI_DAILY_GLOBAL_LIMIT: '2',
  });
  let current = fixedNow;
  const app = createWorkerApp({ now: () => current, routerFactory: () => successRouter() });
  const token = await issueWorkerSession(app, env);
  assert.equal((await answer(app, env, token, workerRequest({ requestId: 'global-1' }))).status, 200);
  current = new Date(fixedNow.getTime() + 61_000);
  assert.equal((await answer(app, env, token, workerRequest({ requestId: 'global-2' }))).status, 200);
  current = new Date(fixedNow.getTime() + 122_000);
  assert.equal((await answer(app, env, token, workerRequest({ requestId: 'global-3' }))).status, 429);
});

test('malformed input, model aliases, and browser origins fail before quota/provider use', async () => {
  const { env } = await workerTestFixture();
  let calls = 0;
  const app = createWorkerApp({ now: () => fixedNow, routerFactory: () => successRouter(() => { calls += 1; }) });
  const token = await issueWorkerSession(app, env);
  const badModel = await answer(app, env, token, workerRequest({ modelId: 'provider-specific-model' }));
  assert.equal(badModel.status, 400);
  const badConsent = await answer(app, env, token, workerRequest({ consent: { granted: true, version: 'old-consent-version' } }));
  assert.equal(badConsent.status, 400);
  const browser = await app(new Request('https://worker.test/health', { headers: { origin: 'https://example.test' } }), env);
  assert.equal(browser.status, 403);
  assert.equal(calls, 0);
});

test('sanitized logs and public errors contain no questions, excerpts, keys, or raw failures', async () => {
  const { env } = await workerTestFixture();
  const events: WorkerOperationalLogEvent[] = [];
  const sensitive = 'CONFIDENTIAL-SYNTHETIC-PHRASE';
  const app = createWorkerApp({
    now: () => fixedNow,
    logger: { write(event) { events.push(event); } },
    routerFactory: () => ({ answer: async () => { throw new Error(`raw ${sensitive}`); } }),
  });
  const token = await issueWorkerSession(app, env);
  const response = await answer(app, env, token, workerRequest({
    question: sensitive,
    evidence: [{ ...workerRequest().evidence[0]!, excerpt: sensitive }],
  }));
  assert.equal(response.status, 500);
  const combined = `${await response.text()}${JSON.stringify(events)}`;
  assert.doesNotMatch(combined, new RegExp(sensitive));
  assert.doesNotMatch(combined, /fake-gemini-key|fake-groq-key|AAAAAAAAAAAA/);
  assert.equal(events.at(-1)?.evidenceCount, 1);
});

function successRouter(onCall: () => void = () => undefined): ProviderRouterLike {
  return {
    answer: async () => {
      onCall();
      return { result: providerSuccess(), provider: 'gemini', fallbackUsed: false };
    },
  };
}

function answer(
  app: ReturnType<typeof createWorkerApp>,
  env: Awaited<ReturnType<typeof workerTestFixture>>['env'],
  token: string,
  payload: unknown,
): Promise<Response> {
  return app(new Request('https://worker.test/api/v1/answers', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }), env);
}
