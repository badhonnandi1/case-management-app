import assert from 'node:assert/strict';
import test from 'node:test';

import type { GenerateContentResponse } from '@google/genai';

import { answerRequestSchema } from '../src/contracts.js';
import { normalizeProviderError } from '../src/errors.js';
import { GeminiAnswerProvider, type GeminiGenerator } from '../src/provider/geminiProvider.js';
import { parseAndResolveProviderAnswer } from '../src/provider/providerResponse.js';
import { validAnswerRequest } from './helpers.js';

const request = answerRequestSchema.parse(validAnswerRequest());

test('parses valid output and resolves citation metadata only from submitted evidence', () => {
  const result = parseAndResolveProviderAnswer(JSON.stringify({
    answer: 'The date is 12 September 2026.',
    citations: [{ evidenceId: 'evidence-1', supportingStatement: 'Date statement' }],
    insufficientEvidence: false,
    warnings: [],
  }), request);
  assert.equal(result.citations[0]?.documentName, request.evidence[0]?.documentName);
  assert.equal(result.citations[0]?.pageStart, 2);
  assert.equal(result.citations[0]?.citationNumber, 1);
});

test('normalizes duplicate citations deterministically', () => {
  const result = parseAndResolveProviderAnswer(JSON.stringify({
    answer: 'The date is stated.',
    citations: [{ evidenceId: 'evidence-1' }, { evidenceId: 'evidence-1', supportingStatement: 'duplicate' }],
    insufficientEvidence: false,
    warnings: [],
  }), request);
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0]?.citationNumber, 1);
});

test('rejects invalid JSON, empty answers, unknown citations, and unsupported uncited answers', () => {
  const invalidValues = [
    'not-json',
    JSON.stringify({ answer: '', citations: [], insufficientEvidence: true, warnings: [] }),
    JSON.stringify({ answer: 'Invented', citations: [{ evidenceId: 'made-up' }], insufficientEvidence: false, warnings: [] }),
    JSON.stringify({ answer: 'A factual answer', citations: [], insufficientEvidence: false, warnings: [] }),
  ];
  for (const value of invalidValues) {
    assert.throws(() => parseAndResolveProviderAnswer(value, request), (error: unknown) => (
      error instanceof Error && error.name === 'PublicApiError'
    ));
  }
});

test('allows an uncited response only when explicitly insufficient', () => {
  const result = parseAndResolveProviderAnswer(JSON.stringify({
    answer: 'The supplied evidence is insufficient to answer the question.',
    citations: [], insufficientEvidence: true, warnings: ['More source material is needed.'],
  }), request);
  assert.equal(result.insufficientEvidence, true);
  assert.deepEqual(result.citations, []);
});

test('Gemini adapter retries one invalid structured response and normalizes real usage fields', async () => {
  let calls = 0;
  const generator: GeminiGenerator = {
    async generateContent() {
      calls += 1;
      if (calls === 1) return { text: 'invalid json' } as GenerateContentResponse;
      return {
        text: JSON.stringify({
          answer: 'The date is 12 September 2026.',
          citations: [{ evidenceId: 'evidence-1', supportingStatement: null }],
          insufficientEvidence: false,
          warnings: [],
        }),
        usageMetadata: { promptTokenCount: 101, candidatesTokenCount: 22, totalTokenCount: 123 },
      } as GenerateContentResponse;
    },
  };
  const provider = new GeminiAnswerProvider(null, generator);
  const result = await provider.answer(request, new AbortController().signal, 'gemini-test');
  assert.equal(calls, 2);
  assert.deepEqual(
    { input: result.usage.inputTokens, output: result.usage.outputTokens, total: result.usage.totalTokens },
    { input: 101, output: 22, total: 123 },
  );
});

test('Gemini adapter rejects a fabricated citation after one repair attempt', async () => {
  let calls = 0;
  const generator: GeminiGenerator = {
    async generateContent() {
      calls += 1;
      return {
        text: JSON.stringify({ answer: 'Invented', citations: [{ evidenceId: 'unknown' }], insufficientEvidence: false, warnings: [] }),
      } as GenerateContentResponse;
    },
  };
  const provider = new GeminiAnswerProvider(null, generator);
  await assert.rejects(() => provider.answer(request, new AbortController().signal, 'gemini-test'), /unknown citation/i);
  assert.equal(calls, 2);
});

test('provider failures are normalized without exposing raw messages', () => {
  const rateLimit = normalizeProviderError({ status: 429, message: 'raw quota detail' });
  assert.equal(rateLimit.code, 'RATE_LIMITED');
  assert.doesNotMatch(rateLimit.message, /quota detail/);
  const unavailable = normalizeProviderError({ status: 503, message: 'raw account detail' });
  assert.equal(unavailable.code, 'PROVIDER_UNAVAILABLE');
  assert.doesNotMatch(unavailable.message, /account detail/);
});
