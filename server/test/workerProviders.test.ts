import assert from 'node:assert/strict';
import test from 'node:test';

import { answerRequestSchema } from '../src/contracts.js';
import { loadWorkerConfig } from '../src/worker/config.js';
import { WorkerProviderError } from '../src/worker/providerErrors.js';
import { WorkerProviderRouter } from '../src/worker/providerRouter.js';
import { GeminiRestProvider, GroqRestProvider, type ProviderFetch } from '../src/worker/restProviders.js';
import { WorkerSecurityStore } from '../src/worker/securityStore.js';
import { providerSuccess, workerRequest, workerTestFixture } from './workerHelpers.js';

const validOutput = JSON.stringify({
  answer: 'The order is dated 12 September 2026.',
  citations: [{ evidenceId: 'evidence-1', supportingStatement: null }],
  insufficientEvidence: false,
  warnings: [],
});

test('Gemini REST success uses the evidence-only contract and provider-neutral usage name', async () => {
  let sentBody = '';
  const provider = new GeminiRestProvider('secret-key', 'gemini-internal', 'Balanced', 1024, mockFetch(async (_input, init) => {
    const requestBody = init?.body;
    if (typeof requestBody !== 'string') throw new Error('Expected a JSON request body.');
    sentBody = requestBody;
    return Response.json({
      candidates: [{ content: { parts: [{ text: validOutput }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 11, totalTokenCount: 41 },
    });
  }));
  const result = await provider.answer(answerRequestSchema.parse(workerRequest()), new AbortController().signal);
  assert.equal(result.usage.modelName, 'Balanced');
  assert.equal(result.citations[0]?.documentName, 'Synthetic Order.pdf');
  assert.match(sentBody, /evidence-grounded document assistant/);
  assert.match(sentBody, /responseJsonSchema/);
  assert.match(sentBody, /maxOutputTokens/);
  assert.doesNotMatch(JSON.stringify(result), /gemini-internal|secret-key/);
});

test('Groq REST success passes through exactly the same citation resolver', async () => {
  const provider = new GroqRestProvider('groq-secret', 'openai/gpt-oss-20b', 'Balanced', 1024, mockFetch(async (_input, init) => {
    const requestBody = init?.body;
    if (typeof requestBody !== 'string') throw new Error('Expected a JSON request body.');
    const body = JSON.parse(requestBody) as Record<string, unknown>;
    assert.deepEqual((body.response_format as { type: string }).type, 'json_schema');
    return Response.json({
      choices: [{ message: { content: validOutput }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 35, completion_tokens: 12, total_tokens: 47 },
    });
  }));
  const result = await provider.answer(answerRequestSchema.parse(workerRequest()), new AbortController().signal);
  assert.equal(result.citations[0]?.evidenceId, 'evidence-1');
  assert.equal(result.usage.modelName, 'Balanced');
});

test('retryable Gemini rate limit falls back once to Groq', async () => {
  const { env, db } = await workerTestFixture();
  let geminiCalls = 0;
  let groqCalls = 0;
  const router = new WorkerProviderRouter(loadWorkerConfig(env), new WorkerSecurityStore(db), fetch, {
    gemini: { answer: async () => { geminiCalls += 1; throw retryable(); } },
    groq: { answer: async () => { groqCalls += 1; return providerSuccess(); } },
  });
  const result = await router.answer(answerRequestSchema.parse(workerRequest()), new AbortController().signal, 1_788_523_200);
  assert.equal(result.provider, 'groq');
  assert.equal(result.fallbackUsed, true);
  assert.equal(geminiCalls, 1);
  assert.equal(groqCalls, 1);
});

test('a primary provider timeout opens a short circuit and uses a fresh fallback signal', async () => {
  const { env, db } = await workerTestFixture();
  const config = { ...loadWorkerConfig(env), providerTimeoutMs: 10 };
  let groqSignalAborted = true;
  const router = new WorkerProviderRouter(config, new WorkerSecurityStore(db), fetch, {
    gemini: {
      answer: async (_request, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
    },
    groq: {
      answer: async (_request, signal) => {
        groqSignalAborted = signal.aborted;
        return providerSuccess();
      },
    },
  });
  const result = await router.answer(answerRequestSchema.parse(workerRequest()), new AbortController().signal, 1_788_523_200);
  assert.equal(result.provider, 'groq');
  assert.equal(groqSignalAborted, false);
});

test('non-retryable provider failures and safety refusals never use fallback', async () => {
  const { env, db } = await workerTestFixture();
  let groqCalls = 0;
  for (const failure of [
    new WorkerProviderError('PROVIDER_UNAVAILABLE', 400, 'Rejected.', 'client', false),
    new WorkerProviderError('PROVIDER_UNAVAILABLE', 422, 'Safety refusal.', 'safety', false),
  ]) {
    const router = new WorkerProviderRouter(loadWorkerConfig(env), new WorkerSecurityStore(db), fetch, {
      gemini: { answer: async () => { throw failure; } },
      groq: { answer: async () => { groqCalls += 1; return providerSuccess(); } },
    });
    await assert.rejects(
      () => router.answer(answerRequestSchema.parse(workerRequest()), new AbortController().signal, 1_788_523_200),
      (error: unknown) => error === failure,
    );
  }
  assert.equal(groqCalls, 0);
});

test('malformed Gemini output gets one repair attempt and never falls back', async () => {
  let geminiCalls = 0;
  let groqCalls = 0;
  const providerFetch = mockFetch(async () => {
    geminiCalls += 1;
    return Response.json({ candidates: [{ content: { parts: [{ text: 'not-json' }] }, finishReason: 'STOP' }] });
  });
  const { env, db } = await workerTestFixture();
  const config = loadWorkerConfig(env);
  const router = new WorkerProviderRouter(config, new WorkerSecurityStore(db), fetch, {
    gemini: new GeminiRestProvider('key', 'model', 'Balanced', 1024, providerFetch),
    groq: { answer: async () => { groqCalls += 1; return providerSuccess(); } },
  });
  await assert.rejects(
    () => router.answer(answerRequestSchema.parse(workerRequest()), new AbortController().signal, 1_788_523_200),
    (error: unknown) => error instanceof WorkerProviderError && error.category === 'invalid_response',
  );
  assert.equal(geminiCalls, 2);
  assert.equal(groqCalls, 0);
});

test('fabricated citations fail the common validator for Groq without fallback or leakage', async () => {
  const fabricated = JSON.stringify({
    answer: 'Invented.', citations: [{ evidenceId: 'not-supplied' }], insufficientEvidence: false, warnings: [],
  });
  let calls = 0;
  const provider = new GroqRestProvider('secret', 'internal-model', 'Balanced', 1024, mockFetch(async () => {
    calls += 1;
    return Response.json({ choices: [{ message: { content: fabricated }, finish_reason: 'stop' }] });
  }));
  await assert.rejects(
    () => provider.answer(answerRequestSchema.parse(workerRequest()), new AbortController().signal),
    (error: unknown) => error instanceof WorkerProviderError
      && error.category === 'invalid_response'
      && !error.message.includes('not-supplied'),
  );
  assert.equal(calls, 2);
});

function retryable(): WorkerProviderError {
  return new WorkerProviderError('RATE_LIMITED', 429, 'Busy.', 'rate_limit', true, 30);
}

function mockFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): ProviderFetch {
  return handler as ProviderFetch;
}
