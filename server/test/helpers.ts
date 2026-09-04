import type { FastifyInstance } from 'fastify';

import {
  AI_CONSENT_VERSION,
  type AiAnswerRequestDto,
  type AiResolvedCitationDto,
} from '../../shared/aiAnswerContract.js';
import type { ServerConfig } from '../src/config.js';
import type { ValidatedAnswerRequest } from '../src/contracts.js';
import type { AiAnswerProvider, ProviderAnswerResult } from '../src/provider/provider.js';

export const testConfig: ServerConfig = {
  host: '127.0.0.1',
  port: 8787,
  production: false,
  trustProxy: false,
  allowedOrigins: ['https://allowed.example'],
  providerTimeoutMs: 1_000,
  answerRateLimitPerMinute: 10,
  ipRateLimitPerMinute: 30,
  sessionIssueLimitPerMinute: 10,
  sessionTtlSeconds: 900,
  sessionSigningSecret: null,
  onlineAnswersEnabled: true,
  geminiApiKey: null,
  geminiDefaultModel: 'gemini-3.8-flash',
  geminiAllowedModels: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'],
  privacyPolicyId: 'gemini-free-selected-excerpts-2026-09-04',
  consentPolicyVersion: AI_CONSENT_VERSION,
};

export function validAnswerRequest(overrides: Partial<AiAnswerRequestDto> = {}): AiAnswerRequestDto {
  return {
    requestId: 'request-0001',
    threadId: 'thread-0001',
    question: 'What date is stated in the order?',
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
      excerpt: 'The next hearing is fixed for 12 September 2026.',
      localRank: -1.25,
    }],
    language: 'auto',
    consent: { granted: true, version: AI_CONSENT_VERSION },
    ...overrides,
  };
}

export function successProvider(onCall?: (request: ValidatedAnswerRequest, signal: AbortSignal) => void): AiAnswerProvider {
  return {
    configured: true,
    async answer(request, signal, modelId): Promise<ProviderAnswerResult> {
      onCall?.(request, signal);
      const evidence = request.evidence[0];
      if (!evidence) throw new Error('Test evidence is missing.');
      const citation: AiResolvedCitationDto = {
        evidenceId: evidence.evidenceId,
        chunkId: evidence.chunkId,
        caseId: evidence.caseId,
        documentId: evidence.documentId,
        documentName: evidence.documentName,
        pageStart: evidence.pageStart,
        pageEnd: evidence.pageEnd,
        citationNumber: 1,
        supportingStatement: null,
      };
      return {
        answer: 'The supplied order states 12 September 2026.',
        citations: [citation],
        insufficientEvidence: false,
        warnings: [],
        usage: { modelName: modelId, inputTokens: 20, outputTokens: 8, totalTokens: 28, durationMs: 3 },
      };
    },
  };
}

export async function issueSession(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/sessions' });
  if (response.statusCode !== 200) throw new Error('Test session could not be issued.');
  return (response.json() as { sessionToken: string }).sessionToken;
}
