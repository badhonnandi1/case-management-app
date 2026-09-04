import { AI_API_LIMITS } from '../../shared/aiAnswerContract';
import type { PreparedAiConversationEvidence, RestoredAiConversation } from '../models/AiConversation';
import {
  getAiMessagesWithCitations,
  getAiThreadById,
  updateAiThreadScope,
} from '../repositories/aiChatRepository';
import { validateAiCitationTarget } from '../repositories/aiChunkRepository';
import { getCasesByIds } from '../repositories/caseRepository';
import { getDocumentsByCaseIds, getDocumentsByIds } from '../repositories/documentRepository';
import { inspectAiDocumentChoices } from './aiDocumentStatusService';
import { retrieveLocalContext } from './aiRetrievalService';

export type AiConversationPreparationErrorCode =
  | 'THREAD_MISSING'
  | 'EMPTY_SCOPE'
  | 'NO_READY_SOURCES'
  | 'NO_EVIDENCE'
  | 'CANCELLED';

export class AiConversationPreparationError extends Error {
  readonly code: AiConversationPreparationErrorCode;

  constructor(code: AiConversationPreparationErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'AiConversationPreparationError';
  }
}

export async function restoreAiConversation(
  threadId: string,
  signal?: AbortSignal,
): Promise<RestoredAiConversation> {
  const thread = await getAiThreadById(threadId);
  if (!thread) throw new AiConversationPreparationError('THREAD_MISSING', 'This prepared session no longer exists.');
  throwIfCancelled(signal);
  const cases = await getCasesByIds(thread.caseIds);
  const caseIds = cases.map((item) => item.id);
  const availableDocuments = await getDocumentsByCaseIds(caseIds);
  const availableById = new Map(availableDocuments.map((document) => [document.id, document]));
  const documentIds = thread.documentIds.filter((id) => availableById.has(id));
  const documents = documentIds.flatMap((id) => {
    const document = availableById.get(id);
    return document ? [document] : [];
  });
  const scopeChanged = caseIds.length !== thread.caseIds.length || documentIds.length !== thread.documentIds.length;
  if (scopeChanged) await updateAiThreadScope(thread.id, caseIds, documentIds);
  throwIfCancelled(signal);
  const [messages, choices] = await Promise.all([
    getAiMessagesWithCitations(threadId),
    inspectAiDocumentChoices(cases, documents, { signal }),
  ]);
  throwIfCancelled(signal);
  const activeDocumentIds = new Set(documentIds);
  const historicalDocumentIds = [...new Set(messages.flatMap((entry) => entry.citations.map((citation) => citation.documentId)))]
    .filter((id) => !activeDocumentIds.has(id));
  const historicalDocuments = await getDocumentsByIds(historicalDocumentIds);
  const activeCaseIds = new Set(caseIds);
  const historicalCases = await getCasesByIds(
    [...new Set(historicalDocuments.map((document) => document.caseId))].filter((id) => !activeCaseIds.has(id)),
  );
  throwIfCancelled(signal);
  return {
    thread: { ...thread, caseIds, documentIds },
    messages,
    cases: [...cases, ...historicalCases],
    documents: [...documents, ...historicalDocuments],
    choices,
    readySourceCount: choices.filter((choice) => choice.status === 'ready').length,
    scopeChanged: scopeChanged || historicalDocumentIds.length > 0,
  };
}

export async function prepareAiConversationEvidence(input: {
  threadId: string;
  question: string;
  signal?: AbortSignal;
}): Promise<PreparedAiConversationEvidence> {
  throwIfCancelled(input.signal);
  const thread = await getAiThreadById(input.threadId);
  if (!thread) throw new AiConversationPreparationError('THREAD_MISSING', 'This prepared session no longer exists.');
  throwIfCancelled(input.signal);

  const cases = await getCasesByIds(thread.caseIds);
  const caseIds = cases.map((item) => item.id);
  if (caseIds.length === 0) {
    throw new AiConversationPreparationError('EMPTY_SCOPE', 'All selected cases were removed. Select sources again.');
  }
  const documents = await getDocumentsByCaseIds(caseIds);
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const documentIds = thread.documentIds.filter((id) => documentById.has(id));
  const scopeChanged = caseIds.length !== thread.caseIds.length || documentIds.length !== thread.documentIds.length;
  if (scopeChanged) await updateAiThreadScope(thread.id, caseIds, documentIds);
  if (documentIds.length === 0) {
    throw new AiConversationPreparationError('EMPTY_SCOPE', 'All selected documents were removed. Select sources again.');
  }
  throwIfCancelled(input.signal);

  const scopedDocuments = documentIds.flatMap((id) => {
    const document = documentById.get(id);
    return document ? [document] : [];
  });
  const choices = await inspectAiDocumentChoices(cases, scopedDocuments, { signal: input.signal });
  throwIfCancelled(input.signal);
  const readyDocumentIds = choices
    .filter((choice) => choice.status === 'ready' && choice.source?.extractionStatus === 'ready')
    .map((choice) => choice.document.id);
  if (readyDocumentIds.length === 0) {
    throw new AiConversationPreparationError(
      'NO_READY_SOURCES',
      'No selected document has a current ready index. Re-index changed documents or change sources.',
    );
  }

  const retrieved = await retrieveLocalContext(
    input.question,
    { caseIds, documentIds: readyDocumentIds },
    AI_API_LIMITS.evidenceItems,
  );
  throwIfCancelled(input.signal);
  const caseScope = new Set(caseIds);
  const documentScope = new Set(readyDocumentIds);
  const evidence = [];
  for (const result of retrieved.slice(0, AI_API_LIMITS.evidenceItems)) {
    if (!caseScope.has(result.caseId) || !documentScope.has(result.documentId)) continue;
    if (!(await validateAiCitationTarget({
      chunkId: result.chunkId,
      documentId: result.documentId,
      pageStart: result.pageStart,
      pageEnd: result.pageEnd,
    }))) continue;
    evidence.push(result);
  }
  throwIfCancelled(input.signal);
  if (evidence.length === 0) {
    throw new AiConversationPreparationError(
      'NO_EVIDENCE',
      'No relevant text was found in the prepared sources. Try local search or change the selected sources.',
    );
  }

  return {
    thread: { ...thread, caseIds, documentIds },
    caseIds,
    documentIds,
    readyDocumentIds,
    evidence,
    scopeChanged,
    unavailableDocumentCount: choices.length - readyDocumentIds.length,
  };
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new AiConversationPreparationError('CANCELLED', 'The request was cancelled.');
  }
}
