import { answerRequestSchema } from '../src/contracts.js';
import { GeminiRestProvider, GroqRestProvider } from '../src/worker/restProviders.js';

const providerName = process.argv[2];
if (providerName !== 'gemini' && providerName !== 'groq') {
  throw new Error('Use provider-smoke.ts with gemini or groq.');
}
const apiKey = providerName === 'gemini' ? process.env.GEMINI_API_KEY : process.env.GROQ_API_KEY;
if (!apiKey) throw new Error(`The ${providerName} key is not configured in the local ignored Worker secrets file.`);

const request = answerRequestSchema.parse({
  requestId: `synthetic-${crypto.randomUUID()}`,
  threadId: 'synthetic-thread',
  question: 'On what date was the fictional testing order signed?',
  selectedCaseIds: ['synthetic-case'],
  selectedDocumentIds: ['synthetic-document'],
  evidence: [{
    evidenceId: 'synthetic-evidence-1',
    chunkId: 'synthetic-chunk-1',
    caseId: 'synthetic-case',
    documentId: 'synthetic-document',
    documentName: 'Synthetic Test Order.pdf',
    pageStart: 1,
    pageEnd: 1,
    excerpt: 'This fictional order was signed on 12 September 2026 solely for system testing.',
    localRank: 1,
  }],
  language: 'en',
  modelId: 'balanced',
  consent: { granted: true, version: '2026-09-04-free-providers-selected-excerpts-v2' },
});

const model = providerName === 'gemini'
  ? process.env.GEMINI_DEFAULT_MODEL ?? 'gemini-3.8-flash'
  : process.env.GROQ_FALLBACK_MODEL ?? 'openai/gpt-oss-20b';
const provider = providerName === 'gemini'
  ? new GeminiRestProvider(apiKey, model, 'Balanced', 1_024)
  : new GroqRestProvider(apiKey, model, 'Balanced', 1_024);
const result = await provider.answer(request, AbortSignal.timeout(30_000));
console.log(JSON.stringify({
  provider: providerName,
  validated: true,
  insufficientEvidence: result.insufficientEvidence,
  citationIds: result.citations.map((citation) => citation.evidenceId),
  usage: result.usage,
}));
