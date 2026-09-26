import assert from 'node:assert/strict';
import test from 'node:test';

import type { AiPublicConfigDto } from '../../shared/aiAnswerContract.js';

import { buildServerApp } from '../src/app.js';
import type { OperationalLogEvent } from '../src/logger.js';
import type { AiAnswerProvider } from '../src/provider/provider.js';
import { issueSession, successProvider, testConfig, validAnswerRequest } from './helpers.js';

test('accepts a valid scoped request and returns server-resolved citations', async () => {
  let calls = 0;
  const app = await buildServerApp({ config: testConfig, provider: successProvider(() => { calls += 1; }) });
  const token = await issueSession(app);
  const response = await app.inject({
    method: 'POST', url: '/api/v1/answers',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: validAnswerRequest(),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(calls, 1);
  const body = response.json();
  assert.equal(body.requestId, 'request-0001');
  assert.deepEqual(body.citations[0], {
    evidenceId: 'evidence-1', chunkId: 'chunk-1', caseId: 'case-1', documentId: 'document-1',
    documentName: 'Synthetic Order.pdf', pageStart: 2, pageEnd: 2, citationNumber: 1, supportingStatement: null,
  });
  await app.close();
});

test('rejects malformed, empty, inconsistent, duplicate, and unknown-field requests before provider use', async () => {
  let calls = 0;
  const app = await buildServerApp({ config: testConfig, provider: successProvider(() => { calls += 1; }) });
  const token = await issueSession(app);
  const cases: Array<[string, unknown, string]> = [
    ['empty question', validAnswerRequest({ question: ' ' }), 'INVALID_REQUEST'],
    ['empty cases', validAnswerRequest({ selectedCaseIds: [] }), 'EMPTY_SCOPE'],
    ['empty documents', validAnswerRequest({ selectedDocumentIds: [] }), 'EMPTY_SCOPE'],
    ['empty evidence', validAnswerRequest({ evidence: [] }), 'EMPTY_EVIDENCE'],
    ['case outside scope', validAnswerRequest({ evidence: [{ ...validAnswerRequest().evidence[0]!, caseId: 'case-2' }] }), 'INVALID_REQUEST'],
    ['document outside scope', validAnswerRequest({ evidence: [{ ...validAnswerRequest().evidence[0]!, documentId: 'document-2' }] }), 'INVALID_REQUEST'],
    ['invalid pages', validAnswerRequest({ evidence: [{ ...validAnswerRequest().evidence[0]!, pageStart: 3, pageEnd: 2 }] }), 'INVALID_REQUEST'],
    ['duplicate evidence', validAnswerRequest({ evidence: [validAnswerRequest().evidence[0]!, validAnswerRequest().evidence[0]!] }), 'INVALID_REQUEST'],
    ['no consent', { ...validAnswerRequest(), consent: { granted: false, version: '2026-09-03' } }, 'CONSENT_REQUIRED'],
    ['unknown field', { ...validAnswerRequest(), unexpected: true }, 'INVALID_REQUEST'],
  ];
  for (const [name, payload, expectedCode] of cases) {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/answers',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, payload: payload as object,
    });
    assert.equal(response.statusCode, 400, name);
    assert.equal(response.json().error.code, expectedCode, name);
  }
  assert.equal(calls, 0);
  await app.close();
});

test('rejects unsupported content types and oversized bodies', async () => {
  const app = await buildServerApp({ config: testConfig, provider: successProvider() });
  const token = await issueSession(app);
  const unsupported = await app.inject({
    method: 'POST', url: '/api/v1/answers',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' }, payload: 'not json',
  });
  assert.equal(unsupported.statusCode, 415);
  assert.equal(unsupported.json().error.code, 'INVALID_REQUEST');
  const oversized = await app.inject({
    method: 'POST', url: '/api/v1/answers',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: JSON.stringify({ value: 'x'.repeat(70_000) }),
  });
  assert.equal(oversized.statusCode, 413);
  assert.equal(oversized.json().error.code, 'PAYLOAD_TOO_LARGE');
  await app.close();
});

test('enforces anonymous authorization, per-session rate limits, and idempotent request replay', async () => {
  let calls = 0;
  const app = await buildServerApp({
    config: { ...testConfig, answerRateLimitPerMinute: 3 },
    provider: successProvider(() => { calls += 1; }),
  });
  const unauthorized = await app.inject({ method: 'POST', url: '/api/v1/answers', payload: validAnswerRequest() });
  assert.equal(unauthorized.statusCode, 401);
  const token = await issueSession(app);
  const tampered = await app.inject({
    method: 'POST', url: '/api/v1/answers',
    headers: { authorization: `Bearer ${token}x`, 'content-type': 'application/json' }, payload: validAnswerRequest(),
  });
  assert.equal(tampered.statusCode, 401);
  const options = {
    method: 'POST' as const, url: '/api/v1/answers',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, payload: validAnswerRequest(),
  };
  assert.equal((await app.inject(options)).statusCode, 200);
  assert.equal((await app.inject(options)).statusCode, 200);
  assert.equal(calls, 1, 'same safe request ID and payload should replay the first result');
  const limited = await app.inject({ ...options, payload: validAnswerRequest({ requestId: 'request-0002' }) });
  assert.equal(limited.statusCode, 200);
  const overLimit = await app.inject({ ...options, payload: validAnswerRequest({ requestId: 'request-0003' }) });
  assert.equal(overLimit.statusCode, 429);
  assert.equal(overLimit.json().error.code, 'RATE_LIMITED');
  await app.close();
});

test('anonymous sessions remain valid after a stateless service restart', async () => {
  const restartSafeConfig = {
    ...testConfig,
    sessionSigningSecret: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  };
  const firstInstance = await buildServerApp({ config: restartSafeConfig, provider: successProvider() });
  const token = await issueSession(firstInstance);
  await firstInstance.close();

  const restartedInstance = await buildServerApp({ config: restartSafeConfig, provider: successProvider() });
  const response = await restartedInstance.inject({
    method: 'POST',
    url: '/api/v1/answers',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: validAnswerRequest(),
  });
  assert.equal(response.statusCode, 200);
  await restartedInstance.close();
});

test('aborts a provider at the server timeout', async () => {
  let observedAbort = false;
  const provider: AiAnswerProvider = {
    configured: true,
    answer: async (_request, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        observedAbort = true;
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
  };
  const app = await buildServerApp({ config: { ...testConfig, providerTimeoutMs: 20 }, provider });
  const token = await issueSession(app);
  const response = await app.inject({
    method: 'POST', url: '/api/v1/answers',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, payload: validAnswerRequest(),
  });
  assert.equal(response.statusCode, 504);
  assert.equal(response.json().error.code, 'PROVIDER_TIMEOUT');
  assert.equal(observedAbort, true);
  await app.close();
});

test('health and provider-not-configured responses reveal no configuration', async () => {
  const provider: AiAnswerProvider = { configured: false, answer: async () => { throw new Error('must not run'); } };
  const app = await buildServerApp({ config: testConfig, provider });
  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.deepEqual(health.json(), { status: 'degraded', apiVersion: 'v1', onlineAnswers: 'provider_not_configured' });
  const token = await issueSession(app);
  const response = await app.inject({
    method: 'POST', url: '/api/v1/answers',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, payload: validAnswerRequest(),
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error.code, 'PROVIDER_NOT_CONFIGURED');
  assert.doesNotMatch(response.body, /gemini|api.?key|model/i);
  await app.close();
});

test('operational logs and public errors exclude sensitive bodies and raw failures', async () => {
  const events: OperationalLogEvent[] = [];
  const secretPhrase = 'CONFIDENTIAL-QUESTION-AND-EXCERPT';
  const provider: AiAnswerProvider = {
    configured: true,
    answer: async () => { throw new Error(`provider failed with ${secretPhrase}`); },
  };
  const app = await buildServerApp({
    config: testConfig,
    provider,
    logger: { write(event) { events.push(event); } },
  });
  const token = await issueSession(app);
  const payload = validAnswerRequest({ question: secretPhrase, evidence: [{ ...validAnswerRequest().evidence[0]!, excerpt: secretPhrase }] });
  const response = await app.inject({
    method: 'POST', url: '/api/v1/answers',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, payload,
  });
  assert.equal(response.statusCode, 500);
  assert.doesNotMatch(response.body, new RegExp(secretPhrase));
  assert.doesNotMatch(JSON.stringify(events), new RegExp(secretPhrase));
  assert.equal(events.at(-1)?.evidenceCount, 1);
  await app.close();
});

test('strict CORS allows configured web origins and rejects others', async () => {
  const app = await buildServerApp({ config: testConfig, provider: successProvider() });
  const allowed = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://allowed.example' } });
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://allowed.example');
  const rejected = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.example' } });
  assert.equal(rejected.statusCode, 403);
  assert.doesNotMatch(rejected.body, /evil\.example/);
  await app.close();
});

test('production mode rejects non-HTTPS requests at the application boundary', async () => {
  const app = await buildServerApp({
    config: { ...testConfig, production: true, trustProxy: true },
    provider: successProvider(),
  });
  const probe = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(probe.statusCode, 200, 'the managed-platform health probe must work');
  const rejected = await app.inject({ method: 'GET', url: '/api/v1/config' });
  assert.equal(rejected.statusCode, 400);
  const accepted = await app.inject({ method: 'GET', url: '/api/v1/config', headers: { 'x-forwarded-proto': 'https' } });
  assert.equal(accepted.statusCode, 200);
  await app.close();
});

test('public configuration exposes only the model allowlist and conservative policy', async () => {
  const app = await buildServerApp({
    config: {
      ...testConfig,
      geminiApiKey: 'must-never-be-returned',
      sessionSigningSecret: 'also-must-never-be-returned',
    },
    provider: successProvider(),
  });
  const response = await app.inject({ method: 'GET', url: '/api/v1/config' });
  assert.equal(response.statusCode, 200);
  const body = response.json<AiPublicConfigDto>();
  assert.equal(body.providerDisplayName, 'Case Management AI');
  assert.equal(body.defaultModelId, 'balanced');
  assert.deepEqual(body.allowedModels.map((model) => model.id), ['balanced']);
  assert.equal(body.privacy.processingTier, 'free_conservative');
  assert.equal(body.privacy.selectedExcerptsOnly, true);
  assert.equal(body.privacy.originalFilesUploaded, false);
  assert.doesNotMatch(response.body, /must-never-be-returned|also-must-never-be-returned|GEMINI_API_KEY|SESSION_SIGNING_SECRET/);
  await app.close();
});

test('uses an allowed requested model and rejects arbitrary model IDs', async () => {
  const observedModels: string[] = [];
  const baseProvider = successProvider();
  const provider: AiAnswerProvider = {
    configured: true,
    async answer(request, signal, modelId) {
      observedModels.push(modelId);
      return baseProvider.answer(request, signal, modelId);
    },
  };
  const app = await buildServerApp({ config: testConfig, provider });
  const token = await issueSession(app);
  const allowed = await app.inject({
    method: 'POST', url: '/api/v1/answers',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: validAnswerRequest({ requestId: 'model-allowed', modelId: 'gemini-3.5-flash-lite' }),
  });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.json().usage.modelName, 'Balanced');
  const rejected = await app.inject({
    method: 'POST', url: '/api/v1/answers',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: validAnswerRequest({ requestId: 'model-rejected', modelId: 'gemini-arbitrary' }),
  });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.json().error.code, 'MODEL_NOT_ALLOWED');
  assert.deepEqual(observedModels, ['gemini-3.5-flash-lite']);
  await app.close();
});

test('requires consent for the backend current policy version', async () => {
  let calls = 0;
  const app = await buildServerApp({ config: testConfig, provider: successProvider(() => { calls += 1; }) });
  const token = await issueSession(app);
  const response = await app.inject({
    method: 'POST', url: '/api/v1/answers',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: validAnswerRequest({ consent: { granted: true, version: 'obsolete-policy-version' } }),
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'CONSENT_REQUIRED');
  assert.equal(calls, 0);
  await app.close();
});
