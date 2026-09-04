import { getDatabase } from '../database/database';
import type { CreateAiCitationInput, AiCitation } from '../models/AiCitation';
import type {
  AiMessage,
  AiMessageWithCitations,
  CreateAiMessageInput,
  AiMessageRole,
} from '../models/AiMessage';
import type { AiThread, AiThreadSummary, CreateAiThreadInput } from '../models/AiThread';
import { createId } from '../utils/id';

interface ThreadRow { id: string; title: string; created_at: string; updated_at: string }
interface ThreadSummaryRow extends ThreadRow {
  case_count: number;
  document_count: number;
  ready_source_count: number;
}
interface MessageRow { id: string; thread_id: string; role: AiMessageRole; content: string; model_name: string | null; input_tokens: number | null; output_tokens: number | null; estimated_cost: number | null; created_at: string }
interface CitationRow { id: string; message_id: string; chunk_id: string; document_id: string; page_start: number; page_end: number; citation_number: number }

export async function createAiThread(input: CreateAiThreadInput): Promise<AiThread> {
  const title = input.title.trim();
  if (!title) throw new Error('A chat title is required.');
  const database = await getDatabase();
  const id = createId();
  const now = new Date().toISOString();
  const caseIds = uniqueIds(input.caseIds ?? []);
  const documentIds = uniqueIds(input.documentIds ?? []);
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      'INSERT INTO ai_threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
      id, title, now, now,
    );
    for (const caseId of caseIds) {
      await transaction.runAsync(
        'INSERT INTO ai_thread_cases (thread_id, case_id) VALUES (?, ?)', id, caseId,
      );
    }
    for (const documentId of documentIds) {
      await transaction.runAsync(
        'INSERT INTO ai_thread_documents (thread_id, document_id) VALUES (?, ?)', id, documentId,
      );
    }
  });
  return { id, title, createdAt: now, updatedAt: now, caseIds, documentIds };
}

export async function getAiThreadById(id: string): Promise<AiThread | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<ThreadRow>(
    'SELECT id, title, created_at, updated_at FROM ai_threads WHERE id = ?', id,
  );
  if (!row) return null;
  const [caseRows, documentRows] = await Promise.all([
    database.getAllAsync<{ case_id: string }>('SELECT case_id FROM ai_thread_cases WHERE thread_id = ? ORDER BY case_id', id),
    database.getAllAsync<{ document_id: string }>('SELECT document_id FROM ai_thread_documents WHERE thread_id = ? ORDER BY document_id', id),
  ]);
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    caseIds: caseRows.map((item) => item.case_id),
    documentIds: documentRows.map((item) => item.document_id),
  };
}

export async function getRecentAiThreads(limit = 20): Promise<AiThreadSummary[]> {
  const database = await getDatabase();
  const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const rows = await database.getAllAsync<ThreadSummaryRow>(
    `SELECT threads.id, threads.title, threads.created_at, threads.updated_at,
       (SELECT COUNT(*) FROM ai_thread_cases WHERE thread_id = threads.id) AS case_count,
       (SELECT COUNT(*) FROM ai_thread_documents WHERE thread_id = threads.id) AS document_count,
       (SELECT COUNT(*) FROM ai_thread_documents AS scoped_documents
        JOIN ai_sources ON ai_sources.document_id = scoped_documents.document_id
        WHERE scoped_documents.thread_id = threads.id
          AND ai_sources.extraction_status = 'ready') AS ready_source_count
     FROM ai_threads AS threads
     ORDER BY threads.updated_at DESC, threads.id ASC LIMIT ?`,
    boundedLimit,
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    caseCount: row.case_count,
    documentCount: row.document_count,
    readySourceCount: row.ready_source_count,
  }));
}

export async function renameAiThread(id: string, titleInput: string): Promise<AiThread | null> {
  const title = titleInput.trim();
  if (!title) throw new Error('A session title is required.');
  const database = await getDatabase();
  const result = await database.runAsync(
    'UPDATE ai_threads SET title = ?, updated_at = ? WHERE id = ?',
    title,
    new Date().toISOString(),
    id,
  );
  return result.changes > 0 ? getAiThreadById(id) : null;
}

export async function updateAiThreadScope(
  id: string,
  caseIdsInput: readonly string[],
  documentIdsInput: readonly string[],
): Promise<AiThread | null> {
  const caseIds = uniqueIds(caseIdsInput);
  const documentIds = uniqueIds(documentIdsInput);
  const database = await getDatabase();
  let updated = false;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const existing = await transaction.getFirstAsync<{ id: string }>(
      'SELECT id FROM ai_threads WHERE id = ?',
      id,
    );
    if (!existing) return;
    await transaction.runAsync('DELETE FROM ai_thread_cases WHERE thread_id = ?', id);
    await transaction.runAsync('DELETE FROM ai_thread_documents WHERE thread_id = ?', id);
    for (const caseId of caseIds) {
      await transaction.runAsync(
        'INSERT INTO ai_thread_cases (thread_id, case_id) VALUES (?, ?)', id, caseId,
      );
    }
    for (const documentId of documentIds) {
      await transaction.runAsync(
        'INSERT INTO ai_thread_documents (thread_id, document_id) VALUES (?, ?)', id, documentId,
      );
    }
    await transaction.runAsync(
      'UPDATE ai_threads SET updated_at = ? WHERE id = ?', new Date().toISOString(), id,
    );
    updated = true;
  });
  return updated ? getAiThreadById(id) : null;
}

export async function saveAiMessageWithCitations(
  messageInput: CreateAiMessageInput,
  citationInputs: readonly CreateAiCitationInput[],
): Promise<{ message: AiMessage; citations: AiCitation[] }> {
  const content = messageInput.content.trim();
  if (!content) throw new Error('A message cannot be empty.');
  validateUsage(messageInput);
  const database = await getDatabase();
  const message: AiMessage = { ...messageInput, content, id: createId(), createdAt: new Date().toISOString() };
  const citations: AiCitation[] = citationInputs.map((citation) => ({
    ...citation,
    id: createId(),
    messageId: message.id,
  }));
  if (message.role !== 'assistant' && citations.length > 0) {
    throw new Error('Only assistant messages can have citations.');
  }
  validateCitationSequence(citations);
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await insertMessage(transaction, message);
    await insertValidatedCitations(transaction, citations);
    await transaction.runAsync(
      'UPDATE ai_threads SET updated_at = ? WHERE id = ?', message.createdAt, message.threadId,
    );
  });
  return { message, citations };
}

export async function saveAiExchangeWithCitations(input: {
  user: CreateAiMessageInput;
  assistant: CreateAiMessageInput;
  citations: readonly CreateAiCitationInput[];
}): Promise<{ user: AiMessage; assistant: AiMessage; citations: AiCitation[] }> {
  if (input.user.role !== 'user' || input.assistant.role !== 'assistant') {
    throw new Error('An AI exchange requires one user message and one assistant message.');
  }
  if (input.user.threadId !== input.assistant.threadId) {
    throw new Error('Both messages must belong to the same thread.');
  }
  const userContent = input.user.content.trim();
  const assistantContent = input.assistant.content.trim();
  if (!userContent || !assistantContent) throw new Error('AI exchange messages cannot be empty.');
  validateUsage(input.user);
  validateUsage(input.assistant);

  const database = await getDatabase();
  const createdAt = new Date().toISOString();
  const user: AiMessage = { ...input.user, id: createId(), content: userContent, createdAt };
  const assistant: AiMessage = {
    ...input.assistant,
    id: createId(),
    content: assistantContent,
    createdAt,
  };
  const citations: AiCitation[] = input.citations.map((citation) => ({
    ...citation,
    id: createId(),
    messageId: assistant.id,
  }));
  validateCitationSequence(citations);

  await database.withExclusiveTransactionAsync(async (transaction) => {
    await insertMessage(transaction, user);
    await insertMessage(transaction, assistant);
    await insertValidatedCitations(transaction, citations);
    const result = await transaction.runAsync(
      'UPDATE ai_threads SET updated_at = ? WHERE id = ?', createdAt, user.threadId,
    );
    if (result.changes !== 1) throw new Error('The AI thread no longer exists.');
  });
  return { user, assistant, citations };
}

export async function getAiMessages(threadId: string): Promise<AiMessage[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<MessageRow>(
    `SELECT id, thread_id, role, content, model_name, input_tokens, output_tokens,
     estimated_cost, created_at FROM ai_messages WHERE thread_id = ?
     ORDER BY created_at ASC, rowid ASC`,
    threadId,
  );
  return rows.map((row) => ({
    id: row.id, threadId: row.thread_id, role: row.role, content: row.content,
    modelName: row.model_name, inputTokens: row.input_tokens, outputTokens: row.output_tokens,
    estimatedCost: row.estimated_cost, createdAt: row.created_at,
  }));
}

export async function getAiMessagesWithCitations(threadId: string): Promise<AiMessageWithCitations[]> {
  const database = await getDatabase();
  const [messages, citationRows] = await Promise.all([
    getAiMessages(threadId),
    database.getAllAsync<CitationRow>(
      `SELECT id, message_id, chunk_id, document_id, page_start, page_end, citation_number
       FROM ai_citations WHERE message_id IN (
         SELECT id FROM ai_messages WHERE thread_id = ?
       ) ORDER BY message_id ASC, citation_number ASC`,
      threadId,
    ),
  ]);
  const citationsByMessage = new Map<string, AiCitation[]>();
  for (const row of citationRows) {
    const citations = citationsByMessage.get(row.message_id) ?? [];
    citations.push({
      id: row.id,
      messageId: row.message_id,
      chunkId: row.chunk_id,
      documentId: row.document_id,
      pageStart: row.page_start,
      pageEnd: row.page_end,
      citationNumber: row.citation_number,
    });
    citationsByMessage.set(row.message_id, citations);
  }
  return messages.map((message) => ({
    message,
    citations: citationsByMessage.get(message.id) ?? [],
  }));
}

export async function clearAiConversation(threadId: string): Promise<boolean> {
  const database = await getDatabase();
  let cleared = false;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const thread = await transaction.getFirstAsync<{ id: string }>(
      'SELECT id FROM ai_threads WHERE id = ?', threadId,
    );
    if (!thread) return;
    await transaction.runAsync('DELETE FROM ai_messages WHERE thread_id = ?', threadId);
    await transaction.runAsync(
      'UPDATE ai_threads SET updated_at = ? WHERE id = ?', new Date().toISOString(), threadId,
    );
    cleared = true;
  });
  return cleared;
}

export async function deleteAiThread(id: string): Promise<boolean> {
  const database = await getDatabase();
  const result = await database.runAsync('DELETE FROM ai_threads WHERE id = ?', id);
  return result.changes > 0;
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function validateUsage(input: CreateAiMessageInput): void {
  for (const value of [input.inputTokens, input.outputTokens, input.estimatedCost]) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      throw new Error('Message usage values must be non-negative.');
    }
  }
}

interface AiChatTransaction {
  runAsync(source: string, ...params: (string | number | null)[]): Promise<{ changes: number }>;
  getFirstAsync<T>(source: string, ...params: (string | number | null)[]): Promise<T | null>;
}

async function insertMessage(transaction: AiChatTransaction, message: AiMessage): Promise<void> {
  await transaction.runAsync(
    `INSERT INTO ai_messages (id, thread_id, role, content, model_name, input_tokens,
     output_tokens, estimated_cost, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    message.id, message.threadId, message.role, message.content, message.modelName,
    message.inputTokens, message.outputTokens, message.estimatedCost, message.createdAt,
  );
}

async function insertValidatedCitations(
  transaction: AiChatTransaction,
  citations: readonly AiCitation[],
): Promise<void> {
  for (const citation of citations) {
    const chunk = await transaction.getFirstAsync<{
      document_id: string;
      page_start: number;
      page_end: number;
      extraction_status: string;
    }>(
      `SELECT chunks.document_id, chunks.page_start, chunks.page_end, sources.extraction_status
       FROM ai_chunks AS chunks
       JOIN ai_sources AS sources ON sources.id = chunks.source_id
       WHERE chunks.id = ?`,
      citation.chunkId,
    );
    if (!chunk || chunk.extraction_status !== 'ready'
      || chunk.document_id !== citation.documentId
      || chunk.page_start !== citation.pageStart
      || chunk.page_end !== citation.pageEnd) {
      throw new Error('A citation no longer matches a ready local source chunk.');
    }
    await transaction.runAsync(
      `INSERT INTO ai_citations (id, message_id, chunk_id, document_id, page_start,
       page_end, citation_number) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      citation.id, citation.messageId, citation.chunkId, citation.documentId,
      citation.pageStart, citation.pageEnd, citation.citationNumber,
    );
  }
}

function validateCitationSequence(citations: readonly AiCitation[]): void {
  const chunks = new Set<string>();
  for (const [index, citation] of citations.entries()) {
    if (citation.citationNumber !== index + 1 || chunks.has(citation.chunkId)) {
      throw new Error('Citations must be unique and numbered in order.');
    }
    chunks.add(citation.chunkId);
  }
}
