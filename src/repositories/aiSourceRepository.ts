import { getDatabase } from '../database/database';
import type { AiExtractionStatus, AiSource } from '../models/AiSource';
import { createId } from '../utils/id';
export { classifyAiSource } from '../utils/aiIndexState';

interface AiSourceRow {
  id: string;
  case_id: string;
  document_id: string;
  file_hash: string | null;
  file_size: number | null;
  extraction_status: AiExtractionStatus;
  page_count: number | null;
  extracted_at: string | null;
  parser_version: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

const SOURCE_COLUMNS = `id, case_id, document_id, file_hash, file_size,
  extraction_status, page_count, extracted_at, parser_version, error_message,
  created_at, updated_at`;

function mapSource(row: AiSourceRow): AiSource {
  return {
    id: row.id,
    caseId: row.case_id,
    documentId: row.document_id,
    fileHash: row.file_hash,
    fileSize: row.file_size,
    extractionStatus: row.extraction_status,
    pageCount: row.page_count,
    extractedAt: row.extracted_at,
    parserVersion: row.parser_version,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findAiSourceByDocument(documentId: string): Promise<AiSource | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<AiSourceRow>(
    `SELECT ${SOURCE_COLUMNS} FROM ai_sources WHERE document_id = ?`,
    documentId,
  );
  return row ? mapSource(row) : null;
}

export async function findAiSourcesByDocuments(documentIds: readonly string[]): Promise<AiSource[]> {
  const uniqueIds = [...new Set(documentIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) return [];
  const database = await getDatabase();
  const placeholders = uniqueIds.map(() => '?').join(', ');
  const rows = await database.getAllAsync<AiSourceRow>(
    `SELECT ${SOURCE_COLUMNS} FROM ai_sources
     WHERE document_id IN (${placeholders}) ORDER BY document_id ASC`,
    ...uniqueIds,
  );
  return rows.map(mapSource);
}

export async function markAiSourceIndexing(input: {
  caseId: string;
  documentId: string;
  fileHash: string;
  fileSize: number;
  parserVersion: string;
}): Promise<AiSource> {
  const database = await getDatabase();
  const existing = await findAiSourceByDocument(input.documentId);
  const now = new Date().toISOString();
  if (existing) {
    await database.runAsync(
      `UPDATE ai_sources SET case_id = ?, file_hash = ?, file_size = ?,
        extraction_status = 'indexing', page_count = NULL, extracted_at = NULL,
        parser_version = ?, error_message = NULL, updated_at = ? WHERE id = ?`,
      input.caseId,
      input.fileHash,
      input.fileSize,
      input.parserVersion,
      now,
      existing.id,
    );
  } else {
    await database.runAsync(
      `INSERT INTO ai_sources (${SOURCE_COLUMNS})
       VALUES (?, ?, ?, ?, ?, 'indexing', NULL, NULL, ?, NULL, ?, ?)`,
      createId(),
      input.caseId,
      input.documentId,
      input.fileHash,
      input.fileSize,
      input.parserVersion,
      now,
      now,
    );
  }
  const source = await findAiSourceByDocument(input.documentId);
  if (!source) throw new Error('The document index state could not be saved.');
  return source;
}

export async function markAiSourceUnsearchable(
  documentId: string,
  status: Exclude<AiExtractionStatus, 'ready' | 'indexing'>,
  errorMessage: string | null,
  pageCount: number | null = null,
): Promise<void> {
  const database = await getDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const source = await transaction.getFirstAsync<{ id: string }>(
      'SELECT id FROM ai_sources WHERE document_id = ?',
      documentId,
    );
    if (!source) return;
    await transaction.runAsync('DELETE FROM ai_chunks WHERE source_id = ?', source.id);
    await transaction.runAsync(
      `UPDATE ai_sources SET extraction_status = ?, page_count = ?, extracted_at = NULL,
       error_message = ?, updated_at = ? WHERE id = ?`,
      status,
      pageCount,
      sanitizeIndexError(errorMessage),
      new Date().toISOString(),
      source.id,
    );
  });
}

export async function recordAiSourceStatus(input: {
  caseId: string;
  documentId: string;
  status: Exclude<AiExtractionStatus, 'ready' | 'indexing'>;
  parserVersion: string;
  fileHash?: string | null;
  fileSize?: number | null;
  pageCount?: number | null;
  errorMessage?: string | null;
}): Promise<AiSource> {
  const database = await getDatabase();
  const now = new Date().toISOString();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const existing = await transaction.getFirstAsync<{ id: string }>(
      'SELECT id FROM ai_sources WHERE document_id = ?', input.documentId,
    );
    if (existing) {
      await transaction.runAsync('DELETE FROM ai_chunks WHERE source_id = ?', existing.id);
      await transaction.runAsync(
        `UPDATE ai_sources SET case_id = ?, file_hash = ?, file_size = ?,
         extraction_status = ?, page_count = ?, extracted_at = NULL,
         parser_version = ?, error_message = ?, updated_at = ? WHERE id = ?`,
        input.caseId, input.fileHash ?? null, input.fileSize ?? null, input.status,
        input.pageCount ?? null, input.parserVersion, sanitizeIndexError(input.errorMessage ?? null),
        now, existing.id,
      );
    } else {
      await transaction.runAsync(
        `INSERT INTO ai_sources (${SOURCE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        createId(), input.caseId, input.documentId, input.fileHash ?? null,
        input.fileSize ?? null, input.status, input.pageCount ?? null, input.parserVersion,
        sanitizeIndexError(input.errorMessage ?? null), now, now,
      );
    }
  });
  const source = await findAiSourceByDocument(input.documentId);
  if (!source) throw new Error('The document index state could not be saved.');
  return source;
}

export async function recoverInterruptedAiSources(): Promise<number> {
  const database = await getDatabase();
  let recovered = 0;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const rows = await transaction.getAllAsync<{ id: string }>(
      "SELECT id FROM ai_sources WHERE extraction_status = 'indexing'",
    );
    for (const row of rows) {
      await transaction.runAsync('DELETE FROM ai_chunks WHERE source_id = ?', row.id);
    }
    const result = await transaction.runAsync(
      `UPDATE ai_sources SET extraction_status = 'failed', extracted_at = NULL,
       error_message = ?, updated_at = ? WHERE extraction_status = 'indexing'`,
      'Indexing was interrupted before completion.',
      new Date().toISOString(),
    );
    recovered = result.changes;
  });
  return recovered;
}

export async function removeDocumentIndex(documentId: string): Promise<boolean> {
  const database = await getDatabase();
  const result = await database.runAsync('DELETE FROM ai_sources WHERE document_id = ?', documentId);
  return result.changes > 0;
}

export async function removeDocumentIndexes(documentIds: readonly string[]): Promise<number> {
  const uniqueIds = [...new Set(documentIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) return 0;
  const database = await getDatabase();
  const placeholders = uniqueIds.map(() => '?').join(', ');
  const result = await database.runAsync(
    `DELETE FROM ai_sources WHERE document_id IN (${placeholders})`,
    ...uniqueIds,
  );
  return result.changes;
}

export async function removeCaseIndexes(caseId: string): Promise<number> {
  const database = await getDatabase();
  const result = await database.runAsync('DELETE FROM ai_sources WHERE case_id = ?', caseId);
  return result.changes;
}

export async function removeAllAiIndexes(): Promise<number> {
  const database = await getDatabase();
  const result = await database.runAsync('DELETE FROM ai_sources');
  return result.changes;
}

function sanitizeIndexError(message: string | null): string | null {
  if (!message) return null;
  return message.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 500) || null;
}
