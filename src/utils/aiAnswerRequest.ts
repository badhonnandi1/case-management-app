import {
  AI_API_LIMITS,
  AI_CONSENT_VERSION,
  type AiAnswerRequestDto,
  type AiLanguagePreference,
} from '../../shared/aiAnswerContract';
import type { AiSearchResult } from '../models/AiChunk';

export type AiAnswerPreparationErrorCode =
  | 'INVALID_REQUEST'
  | 'EMPTY_SCOPE'
  | 'EMPTY_EVIDENCE'
  | 'PAYLOAD_TOO_LARGE'
  | 'CONSENT_REQUIRED';

export class AiAnswerPreparationError extends Error {
  readonly code: AiAnswerPreparationErrorCode;

  constructor(code: AiAnswerPreparationErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'AiAnswerPreparationError';
  }
}

export interface PrepareAiAnswerRequestInput {
  requestId: string;
  threadId: string;
  question: string;
  selectedCaseIds: readonly string[];
  selectedDocumentIds: readonly string[];
  retrievalResults: readonly AiSearchResult[];
  language?: AiLanguagePreference;
  modelId?: string;
  consentVersion?: string;
  consentGranted: boolean;
}

export function prepareAiAnswerRequest(input: PrepareAiAnswerRequestInput): AiAnswerRequestDto {
  if (!input.consentGranted) {
    throw new AiAnswerPreparationError('CONSENT_REQUIRED', 'Review and accept the online AI privacy notice before sending excerpts.');
  }
  const question = input.question.trim();
  if (!question || question.length > AI_API_LIMITS.questionCharacters) {
    throw new AiAnswerPreparationError('INVALID_REQUEST', `Enter a question of at most ${AI_API_LIMITS.questionCharacters} characters.`);
  }
  const selectedCaseIds = normalizeIds(input.selectedCaseIds, AI_API_LIMITS.selectedCases);
  const selectedDocumentIds = normalizeIds(input.selectedDocumentIds, AI_API_LIMITS.selectedDocuments);
  if (selectedCaseIds.length === 0 || selectedDocumentIds.length === 0) {
    throw new AiAnswerPreparationError('EMPTY_SCOPE', 'Select at least one case and one document.');
  }
  if (input.retrievalResults.length === 0) {
    throw new AiAnswerPreparationError('EMPTY_EVIDENCE', 'No relevant local excerpts are available to send.');
  }
  if (input.retrievalResults.length > AI_API_LIMITS.evidenceItems) {
    throw new AiAnswerPreparationError('PAYLOAD_TOO_LARGE', 'Too many evidence excerpts were selected.');
  }
  const caseScope = new Set(selectedCaseIds);
  const documentScope = new Set(selectedDocumentIds);
  const seenChunks = new Set<string>();
  let totalEvidenceCharacters = 0;
  const evidence = input.retrievalResults.map((result, index) => {
    if (!caseScope.has(result.caseId) || !documentScope.has(result.documentId)) {
      throw new AiAnswerPreparationError('INVALID_REQUEST', 'A local result is outside the active case and document scope.');
    }
    if (seenChunks.has(result.chunkId)) {
      throw new AiAnswerPreparationError('INVALID_REQUEST', 'Duplicate local chunks cannot be sent.');
    }
    seenChunks.add(result.chunkId);
    const excerpt = result.content.trim();
    if (!excerpt) throw new AiAnswerPreparationError('EMPTY_EVIDENCE', 'An evidence excerpt is empty.');
    if (excerpt.length > AI_API_LIMITS.evidenceCharacters) {
      throw new AiAnswerPreparationError('PAYLOAD_TOO_LARGE', 'An evidence excerpt is too large.');
    }
    totalEvidenceCharacters += excerpt.length;
    if (totalEvidenceCharacters > AI_API_LIMITS.totalEvidenceCharacters) {
      throw new AiAnswerPreparationError('PAYLOAD_TOO_LARGE', 'The selected evidence is too large.');
    }
    if (!Number.isInteger(result.pageStart) || result.pageStart < 1
      || !Number.isInteger(result.pageEnd) || result.pageEnd < result.pageStart
      || !Number.isFinite(result.rank)) {
      throw new AiAnswerPreparationError('INVALID_REQUEST', 'Local citation metadata is invalid.');
    }
    return {
      evidenceId: `evidence-${index + 1}`,
      chunkId: requireId(result.chunkId),
      caseId: requireId(result.caseId),
      documentId: requireId(result.documentId),
      documentName: result.documentName.trim().slice(0, 240),
      pageStart: result.pageStart,
      pageEnd: result.pageEnd,
      excerpt,
      localRank: result.rank,
    };
  });
  const request: AiAnswerRequestDto = {
    requestId: requireId(input.requestId),
    threadId: requireId(input.threadId),
    question,
    selectedCaseIds,
    selectedDocumentIds,
    evidence,
    language: input.language ?? 'auto',
    ...(input.modelId ? { modelId: requireModelId(input.modelId) } : {}),
    consent: { granted: true, version: requireConsentVersion(input.consentVersion ?? AI_CONSENT_VERSION) },
  };
  if (utf8ByteLength(JSON.stringify(request)) > AI_API_LIMITS.requestBytes) {
    throw new AiAnswerPreparationError('PAYLOAD_TOO_LARGE', 'The online answer request is too large.');
  }
  return request;
}

function requireModelId(value: string): string {
  const normalized = value.trim();
  if (!/^gemini-[a-z0-9.-]+$/.test(normalized) || normalized.length > 128) {
    throw new AiAnswerPreparationError('INVALID_REQUEST', 'The selected AI model is invalid. Refresh AI settings.');
  }
  return normalized;
}

function requireConsentVersion(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._-]{8,128}$/.test(normalized)) {
    throw new AiAnswerPreparationError('INVALID_REQUEST', 'The online consent policy is invalid. Refresh AI settings.');
  }
  return normalized;
}

function normalizeIds(ids: readonly string[], maximum: number): string[] {
  const result = [...new Set(ids.map((id) => requireId(id)))];
  if (result.length > maximum) throw new AiAnswerPreparationError('PAYLOAD_TOO_LARGE', 'The selected scope is too large.');
  return result;
}

function requireId(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 128 || !/^[\p{L}\p{N}._:-]+$/u.test(normalized)) {
    throw new AiAnswerPreparationError('INVALID_REQUEST', 'A local identifier is invalid.');
  }
  return normalized;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
