import { getDatabase } from '../database/database';
import type {
  CaseDocument,
  CreateCaseDocumentInput,
  DocumentFileType,
  UpdateCaseDocumentInput,
} from '../models/CaseDocument';
import { createId } from '../utils/id';

interface DocumentRow {
  id: string;
  case_id: string;
  file_name: string;
  file_path: string;
  file_type: DocumentFileType;
  description: string | null;
  created_at: string;
}

function mapDocument(row: DocumentRow): CaseDocument {
  return {
    id: row.id,
    caseId: row.case_id,
    fileName: row.file_name,
    filePath: row.file_path,
    fileType: row.file_type,
    description: row.description,
    createdAt: row.created_at,
  };
}

export async function createDocument(input: CreateCaseDocumentInput): Promise<CaseDocument> {
  const database = await getDatabase();
  const normalized = normalizeDocumentInput(input);
  const document: CaseDocument = {
    id: createId(),
    ...normalized,
    createdAt: new Date().toISOString(),
  };

  await database.runAsync(
    `INSERT INTO documents (
      id, case_id, file_name, file_path, file_type, description, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    document.id,
    document.caseId,
    document.fileName,
    document.filePath,
    document.fileType,
    document.description,
    document.createdAt,
  );

  return document;
}

export async function getDocumentsByCaseId(caseId: string): Promise<CaseDocument[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<DocumentRow>(
    `SELECT id, case_id, file_name, file_path, file_type, description, created_at
     FROM documents WHERE case_id = ? ORDER BY created_at DESC`,
    caseId,
  );
  return rows.map(mapDocument);
}

export async function getAllDocuments(): Promise<CaseDocument[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<DocumentRow>(
    `SELECT id, case_id, file_name, file_path, file_type, description, created_at
     FROM documents ORDER BY case_id ASC, created_at ASC, id ASC`,
  );
  return rows.map(mapDocument);
}

export async function getDocumentsByCaseIds(caseIds: readonly string[]): Promise<CaseDocument[]> {
  const uniqueIds = [...new Set(caseIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) return [];
  const database = await getDatabase();
  const placeholders = uniqueIds.map(() => '?').join(', ');
  const rows = await database.getAllAsync<DocumentRow>(
    `SELECT id, case_id, file_name, file_path, file_type, description, created_at
     FROM documents WHERE case_id IN (${placeholders})
     ORDER BY case_id ASC, created_at DESC, id ASC`,
    ...uniqueIds,
  );
  return rows.map(mapDocument);
}

export async function getDocumentsByIds(documentIds: readonly string[]): Promise<CaseDocument[]> {
  const uniqueIds = [...new Set(documentIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) return [];
  const database = await getDatabase();
  const rows = await database.getAllAsync<DocumentRow>(
    `SELECT id, case_id, file_name, file_path, file_type, description, created_at
     FROM documents WHERE id IN (${uniqueIds.map(() => '?').join(', ')})
     ORDER BY created_at ASC, id ASC`,
    ...uniqueIds,
  );
  return rows.map(mapDocument);
}

export const getDocumentsForCase = getDocumentsByCaseId;

export async function getDocumentById(id: string): Promise<CaseDocument | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<DocumentRow>(
    `SELECT id, case_id, file_name, file_path, file_type, description, created_at
     FROM documents WHERE id = ?`,
    id,
  );
  return row ? mapDocument(row) : null;
}

export async function updateDocument(
  id: string,
  input: UpdateCaseDocumentInput,
): Promise<CaseDocument | null> {
  const existing = await getDocumentById(id);
  if (!existing) return null;

  const fileName = input.fileName === undefined ? existing.fileName : input.fileName.trim();
  const description = input.description === undefined
    ? existing.description
    : input.description?.trim() || null;
  if (!fileName) throw new Error('Document name is required.');

  const database = await getDatabase();
  await database.runAsync(
    'UPDATE documents SET file_name = ?, description = ? WHERE id = ?',
    fileName,
    description,
    id,
  );
  return getDocumentById(id);
}

export async function deleteDocument(id: string): Promise<boolean> {
  const database = await getDatabase();
  const result = await database.runAsync('DELETE FROM documents WHERE id = ?', id);
  return result.changes > 0;
}

function normalizeDocumentInput(input: CreateCaseDocumentInput): Omit<CaseDocument, 'id' | 'createdAt'> {
  const caseId = input.caseId.trim();
  const fileName = input.fileName.trim();
  const filePath = input.filePath.trim();
  if (!caseId || !fileName || !filePath) throw new Error('Complete document metadata is required.');
  if (input.fileType !== 'PDF' && input.fileType !== 'IMAGE') {
    throw new Error('Unsupported document type.');
  }
  return {
    caseId,
    fileName,
    filePath,
    fileType: input.fileType,
    description: input.description?.trim() || null,
  };
}
