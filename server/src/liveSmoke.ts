import { answerRequestSchema } from './contracts.js';
import { loadServerConfig } from './config.js';
import { GeminiAnswerProvider } from './provider/geminiProvider.js';
import { AI_CONSENT_VERSION } from '../../shared/aiAnswerContract.js';

const config = loadServerConfig();
if (!config.geminiApiKey) {
  process.stderr.write('Live smoke check not run: configure the backend secret, then retry.\n');
  process.exitCode = 2;
} else {
  const provider = new GeminiAnswerProvider(config.geminiApiKey);
  const request = answerRequestSchema.parse({
    requestId: 'synthetic-live-request',
    threadId: 'synthetic-live-thread',
    question: 'According to the supplied excerpt, what is the next hearing date?',
    selectedCaseIds: ['synthetic-case'],
    selectedDocumentIds: ['synthetic-document'],
    evidence: [{
      evidenceId: 'evidence-1',
      chunkId: 'synthetic-chunk',
      caseId: 'synthetic-case',
      documentId: 'synthetic-document',
      documentName: 'Synthetic Order.pdf',
      pageStart: 1,
      pageEnd: 1,
      excerpt: 'In this fictional test matter, the court fixes the next hearing for 12 September 2026.',
      localRank: -1,
    }],
    language: 'en',
    consent: { granted: true, version: AI_CONSENT_VERSION },
  });
  const result = await provider.answer(
    request,
    AbortSignal.timeout(config.providerTimeoutMs),
    config.geminiDefaultModel,
  );
  const citationIds = result.citations.map((citation) => citation.evidenceId);
  if (citationIds.length !== 1 || citationIds[0] !== 'evidence-1') {
    throw new Error('Live response did not resolve only the supplied synthetic citation.');
  }
  process.stdout.write(`${JSON.stringify({
    liveGeminiVerified: true,
    modelName: result.usage.modelName,
    citationIds,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    totalTokens: result.usage.totalTokens,
  })}\n`);
}
