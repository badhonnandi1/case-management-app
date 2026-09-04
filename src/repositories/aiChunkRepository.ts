import { getDatabase } from '../database/database';
import type { AiSearchResult, NewAiChunk } from '../models/AiChunk';
import { createId } from '../utils/id';

export async function replaceDocumentChunksAtomically(input: {
  sourceId: string;
  caseId: string;
  documentId: string;
  fileHash: string;
  fileSize: number;
  parserVersion: string;
  pageCount: number;
  chunks: readonly NewAiChunk[];
}): Promise<void> {
  const database = await getDatabase();
  const now = new Date().toISOString();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const source = await transaction.getFirstAsync<{ extraction_status: string }>(
      'SELECT extraction_status FROM ai_sources WHERE id = ? AND document_id = ?',
      input.sourceId,
      input.documentId,
    );
    if (source?.extraction_status !== 'indexing') {
      throw new Error('The document is no longer in an indexing state.');
    }
    await transaction.runAsync('DELETE FROM ai_chunks WHERE source_id = ?', input.sourceId);
    for (const chunk of input.chunks) {
      await transaction.runAsync(
        `INSERT INTO ai_chunks (
          id, source_id, case_id, document_id, chunk_index,
          page_start, page_end, content, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        createId(),
        input.sourceId,
        input.caseId,
        input.documentId,
        chunk.chunkIndex,
        chunk.pageStart,
        chunk.pageEnd,
        chunk.content,
        now,
      );
    }
    await transaction.runAsync(
      `UPDATE ai_sources SET file_hash = ?, file_size = ?, extraction_status = 'ready',
       page_count = ?, extracted_at = ?, parser_version = ?, error_message = NULL,
       updated_at = ? WHERE id = ?`,
      input.fileHash,
      input.fileSize,
      input.pageCount,
      now,
      input.parserVersion,
      now,
      input.sourceId,
    );
  });
}

export async function searchAiChunks(input: {
  ftsQuery: string;
  caseIds: readonly string[];
  documentIds: readonly string[];
  limit?: number;
}): Promise<AiSearchResult[]> {
  if (input.caseIds.length === 0 && input.documentIds.length === 0) {
    throw new Error('At least one case or document must be selected.');
  }
  if (!input.ftsQuery.trim()) return [];
  const database = await getDatabase();
  const scopeClauses: string[] = [];
  const scopeParameters: string[] = [];
  if (input.caseIds.length > 0) {
    scopeClauses.push(`chunks.case_id IN (${placeholders(input.caseIds.length)})`);
    scopeParameters.push(...input.caseIds);
  }
  if (input.documentIds.length > 0) {
    scopeClauses.push(`chunks.document_id IN (${placeholders(input.documentIds.length)})`);
    scopeParameters.push(...input.documentIds);
  }
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 20)));
  const rows = await database.getAllAsync<AiSearchResultRow>(
    `SELECT chunks.id AS chunk_id, chunks.case_id, chunks.document_id,
      documents.file_name AS document_name, chunks.page_start, chunks.page_end,
      chunks.content, bm25(ai_chunks_fts) AS rank
     FROM ai_chunks_fts
     JOIN ai_chunks AS chunks ON chunks.id = ai_chunks_fts.chunk_id
     JOIN ai_sources AS sources ON sources.id = chunks.source_id
     JOIN documents ON documents.id = chunks.document_id
     WHERE ai_chunks_fts MATCH ?
       AND sources.extraction_status = 'ready'
       AND (${scopeClauses.join(' AND ')})
     ORDER BY rank ASC
     LIMIT ?`,
    input.ftsQuery,
    ...scopeParameters,
    limit,
  );
  return rows.map((row) => ({
    chunkId: row.chunk_id,
    caseId: row.case_id,
    documentId: row.document_id,
    documentName: row.document_name,
    pageStart: row.page_start,
    pageEnd: row.page_end,
    content: row.content,
    rank: row.rank,
  }));
}

export async function validateAiCitationTarget(input: {
  chunkId: string;
  documentId: string;
  pageStart: number;
  pageEnd: number;
}): Promise<boolean> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ id: string }>(
    `SELECT chunks.id
     FROM ai_chunks AS chunks
     JOIN ai_sources AS sources ON sources.id = chunks.source_id
     WHERE chunks.id = ? AND chunks.document_id = ?
       AND chunks.page_start = ? AND chunks.page_end = ?
       AND sources.extraction_status = 'ready'`,
    input.chunkId,
    input.documentId,
    input.pageStart,
    input.pageEnd,
  );
  return Boolean(row);
}

interface AiSearchResultRow {
  chunk_id: string;
  case_id: string;
  document_id: string;
  document_name: string;
  page_start: number;
  page_end: number;
  content: string;
  rank: number;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}
