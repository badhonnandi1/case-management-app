import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseUrl = process.argv[2]?.replace(/\/+$/u, '');
const label = process.argv[3] ?? 'live';
if (!baseUrl || !/^https:\/\/[^/?#]+$/u.test(baseUrl)) throw new Error('Provide the deployed HTTPS Worker origin.');
const serverDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inviteCode = readFileSync(resolve(serverDirectory, '../.secrets/owner-invite-code.txt'), 'utf8').trim();

const sessionResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ inviteCode }),
  signal: AbortSignal.timeout(15_000),
});
if (!sessionResponse.ok) throw new Error(`Session request failed with status ${sessionResponse.status}.`);
const { sessionToken } = await sessionResponse.json();
const response = await fetch(`${baseUrl}/api/v1/answers`, {
  method: 'POST',
  headers: { authorization: `Bearer ${sessionToken}`, 'content-type': 'application/json' },
  body: JSON.stringify({
    requestId: `synthetic-${label}-${crypto.randomUUID()}`,
    threadId: 'synthetic-live-thread',
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
  }),
  signal: AbortSignal.timeout(45_000),
});
const body = await response.json();
if (!response.ok) throw new Error(`Answer request failed with status ${response.status} and code ${body?.error?.code ?? 'unknown'}.`);
console.log(JSON.stringify({
  status: response.status,
  route: response.headers.get('x-ai-route'),
  modelName: body.usage?.modelName,
  citationIds: body.citations?.map((citation) => citation.evidenceId),
  insufficientEvidence: body.insufficientEvidence,
  tokenCounts: {
    input: body.usage?.inputTokens ?? null,
    output: body.usage?.outputTokens ?? null,
    total: body.usage?.totalTokens ?? null,
  },
}));
