import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { prepareAiAnswerRequest, AiAnswerPreparationError } from '../src/utils/aiAnswerRequest.ts';
import { AiBackendWakeCancelledError, pollAiBackendWake } from '../src/utils/aiBackendWake.ts';
import { validateAiBackendUrl } from '../src/services/aiBackendConfig.ts';
import { AiAnswerApiError, createAiAnswerTransport } from '../src/services/aiAnswerTransport.ts';

const baseInput = {
  requestId: 'request-1',
  threadId: 'thread-1',
  question: 'What does the order say?',
  selectedCaseIds: ['case-1'],
  selectedDocumentIds: ['document-1'],
  retrievalResults: [{
    chunkId: 'chunk-1', caseId: 'case-1', documentId: 'document-1',
    documentName: 'Order.pdf', pageStart: 1, pageEnd: 2,
    content: 'The hearing is fixed for 12 September 2026.', rank: -1.2,
    filePath: 'file:///private/confidential/order.pdf',
  }],
  language: 'auto',
  consentGranted: true,
};

const prepared = prepareAiAnswerRequest(baseInput);
const selectedPrepared = prepareAiAnswerRequest({
  ...baseInput,
  modelId: 'gemini-3.8-flash',
  consentVersion: 'current-policy-2026-09-04',
});
assert.equal(selectedPrepared.modelId, 'gemini-3.8-flash');
assert.equal(selectedPrepared.consent.version, 'current-policy-2026-09-04');
assert.deepEqual(prepared.selectedCaseIds, ['case-1']);
assert.deepEqual(prepared.selectedDocumentIds, ['document-1']);
assert.equal(prepared.evidence[0].excerpt, baseInput.retrievalResults[0].content);
assert.doesNotMatch(JSON.stringify(prepared), /file:\/\/|filePath|pdfBytes|imageData/);

assert.throws(
  () => prepareAiAnswerRequest({ ...baseInput, consentGranted: false }),
  (error) => error instanceof AiAnswerPreparationError && error.code === 'CONSENT_REQUIRED',
);
assert.throws(() => prepareAiAnswerRequest({ ...baseInput, question: ' ' }), /question/i);
assert.throws(() => prepareAiAnswerRequest({ ...baseInput, selectedCaseIds: [] }), /Select at least/i);
assert.throws(() => prepareAiAnswerRequest({ ...baseInput, retrievalResults: [] }), /No relevant/i);
assert.throws(
  () => prepareAiAnswerRequest({
    ...baseInput,
    retrievalResults: [{ ...baseInput.retrievalResults[0], caseId: 'unselected-case' }],
  }),
  /outside the active case and document scope/i,
);
assert.throws(
  () => prepareAiAnswerRequest({
    ...baseInput,
    retrievalResults: [{ ...baseInput.retrievalResults[0], documentId: 'unselected-document' }],
  }),
  /outside the active case and document scope/i,
);
assert.throws(
  () => prepareAiAnswerRequest({
    ...baseInput,
    retrievalResults: [{ ...baseInput.retrievalResults[0], content: 'x'.repeat(6_001) }],
  }),
  /too large/i,
);

assert.deepEqual(validateAiBackendUrl(undefined, false), { configured: false, reason: 'not_configured' });
assert.deepEqual(validateAiBackendUrl('http://api.example', true), { configured: false, reason: 'insecure_url' });
assert.equal(validateAiBackendUrl('https://api.example/', true).configured, true);
assert.equal(validateAiBackendUrl('https://user:pass@api.example', true).configured, false);

{
  const progress = [];
  const timeouts = [];
  const results = ['timed_out', 'backend_unreachable', 'healthy'];
  const result = await pollAiBackendWake({
    probe: async (timeoutMs) => {
      timeouts.push(timeoutMs);
      return results.shift();
    },
    shouldRetry: (status) => status === 'timed_out' || status === 'backend_unreachable',
    maxWaitMs: 1_000,
    attemptTimeoutMs: 1_000,
    retryDelayMs: 0,
    onProgress: ({ attempt }) => progress.push(attempt),
  });
  assert.equal(result, 'healthy');
  assert.deepEqual(progress, [1, 2, 3]);
  assert.deepEqual(timeouts, [1_000, 1_000, 1_000]);
}

{
  let attempts = 0;
  const result = await pollAiBackendWake({
    probe: async () => { attempts += 1; return 'device_offline'; },
    shouldRetry: (status) => status === 'timed_out',
  });
  assert.equal(result, 'device_offline');
  assert.equal(attempts, 1);
}

{
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => pollAiBackendWake({ probe: async () => 'healthy', shouldRetry: () => false, signal: controller.signal }),
    (error) => error instanceof AiBackendWakeCancelledError,
  );
}

const responseBody = {
  requestId: prepared.requestId,
  serverRequestId: 'server-1',
  answer: 'The date is 12 September 2026.',
  citations: [{
    evidenceId: 'evidence-1', chunkId: 'chunk-1', caseId: 'case-1', documentId: 'document-1',
    documentName: 'Order.pdf', pageStart: 1, pageEnd: 2, citationNumber: 1, supportingStatement: null,
  }],
  insufficientEvidence: false,
  warnings: [],
  usage: { modelName: 'fake-model', inputTokens: 20, outputTokens: 8, totalTokens: 28, durationMs: 4 },
};

let sessionCalls = 0;
let answerCalls = 0;
const successfulFetch = async (url, init) => {
  if (url.endsWith('/api/v1/sessions')) {
    sessionCalls += 1;
    return jsonResponse(200, { sessionToken: 'anonymous-token', expiresAt: '2999-01-01T00:00:00.000Z' });
  }
  answerCalls += 1;
  assert.equal(init.headers.authorization, 'Bearer anonymous-token');
  assert.deepEqual(JSON.parse(init.body), prepared);
  return jsonResponse(200, responseBody);
};
const transport = createAiAnswerTransport({
  backendUrl: 'https://api.example', production: true, fetchImplementation: successfulFetch,
  isDeviceOnline: async () => true,
});
assert.deepEqual(await transport.send(prepared), responseBody);
assert.equal(sessionCalls, 1);
assert.equal(answerCalls, 1);

{
  let sessions = 0;
  let answers = 0;
  const retryTransport = createAiAnswerTransport({
    backendUrl: 'https://api.example', production: true,
    fetchImplementation: async (url) => {
      if (url.endsWith('/sessions')) {
        sessions += 1;
        return jsonResponse(200, { sessionToken: `token-${sessions}`, expiresAt: '2999-01-01T00:00:00.000Z' });
      }
      answers += 1;
      return answers === 1
        ? jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'raw', serverRequestId: 'server-expired' } })
        : jsonResponse(200, responseBody);
    },
  });
  assert.deepEqual(await retryTransport.send(prepared), responseBody);
  assert.equal(sessions, 2);
  assert.equal(answers, 2);
}

await assert.rejects(
  () => createAiAnswerTransport({
    backendUrl: 'https://api.example', production: true, fetchImplementation: successfulFetch,
    isDeviceOnline: async () => false,
  }).send(prepared),
  (error) => error instanceof AiAnswerApiError && error.code === 'NETWORK_UNAVAILABLE',
);

await assert.rejects(
  () => createAiAnswerTransport({
    backendUrl: 'https://api.example', production: true,
    fetchImplementation: async (url) => url.endsWith('/sessions')
      ? jsonResponse(200, { sessionToken: 'token', expiresAt: '2999-01-01T00:00:00.000Z' })
      : jsonResponse(200, {
        ...responseBody,
        citations: [{ ...responseBody.citations[0], documentId: 'unselected-document' }],
      }),
  }).send(prepared),
  (error) => error instanceof AiAnswerApiError && error.code === 'INVALID_PROVIDER_RESPONSE',
);

await assert.rejects(
  () => createAiAnswerTransport({
    backendUrl: 'https://api.example', production: true,
    fetchImplementation: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
    timeoutMs: 1_000,
  }).send(prepared),
  (error) => error instanceof AiAnswerApiError && error.code === 'PROVIDER_TIMEOUT',
);

{
  const controller = new AbortController();
  const cancellingTransport = createAiAnswerTransport({
    backendUrl: 'https://api.example', production: true,
    fetchImplementation: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  });
  const pending = cancellingTransport.send(prepared, controller.signal);
  controller.abort();
  await assert.rejects(
    () => pending,
    (error) => error instanceof AiAnswerApiError && error.code === 'REQUEST_CANCELLED',
  );
}

await assert.rejects(
  () => createAiAnswerTransport({
    backendUrl: 'https://api.example', production: true,
    fetchImplementation: async (url) => url.endsWith('/sessions')
      ? jsonResponse(200, { sessionToken: 'token', expiresAt: '2999-01-01T00:00:00.000Z' })
      : jsonResponse(429, { error: { code: 'RATE_LIMITED', message: 'raw', serverRequestId: 'server-2', retryAfterSeconds: 30 } }),
  }).send(prepared),
  (error) => error instanceof AiAnswerApiError && error.code === 'RATE_LIMITED' && error.retryAfterSeconds === 30,
);

await assert.rejects(
  () => createAiAnswerTransport({
    backendUrl: 'https://api.example', production: true,
    fetchImplementation: async (url) => url.endsWith('/sessions')
      ? jsonResponse(200, { sessionToken: 'token', expiresAt: '2999-01-01T00:00:00.000Z' })
      : new Response('not json', { status: 200 }),
  }).send(prepared),
  (error) => error instanceof AiAnswerApiError && error.code === 'INVALID_PROVIDER_RESPONSE',
);

const transportSource = readFileSync('src/services/aiAnswerTransport.ts', 'utf8');
const localSearchSource = readFileSync('src/components/ai/LocalSearchPreview.tsx', 'utf8');
const requestSource = readFileSync('src/utils/aiAnswerRequest.ts', 'utf8');
assert.doesNotMatch(localSearchSource, /\bfetch\s*\(|sendOnlineAiAnswer/);
assert.doesNotMatch(`${transportSource}\n${requestSource}`, /console\.|filePath|GEMINI_API_KEY/);
assert.match(readFileSync('src/components/ai/AiOnlineConsent.tsx', 'utf8'), /accessibilityRole="checkbox"/);
assert.doesNotMatch(readFileSync('src/components/ai/AiOnlineConsent.tsx', 'utf8'), /useState\(true\)/);
assert.match(readFileSync('src/components/ai/AiSettingsSection.tsx', 'utf8'), /Starting AI service—this may take up to a minute/);
assert.match(readFileSync('src/screens/AiAssistantScreen.tsx', 'utf8'), /wakeAiBackendAvailability/);

console.log('AI online request scope, privacy, consent, bounded cold-start wake, URL, timeout, cancellation, offline, rate-limit, and response contracts passed.');

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
