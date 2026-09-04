import { File } from 'expo-file-system';

import type { Case } from '../models/Case';
import type { CaseDocument } from '../models/CaseDocument';
import type { AiDocumentChoice, AiDocumentUiStatus } from '../models/AiUi';
import { findAiSourcesByDocuments } from '../repositories/aiSourceRepository';
import { getFileFingerprintAsync } from '../utils/contentHash';
import { PDF_PARSER_VERSION } from './pdfTextExtractionService';

export async function inspectAiDocumentChoices(
  cases: readonly Case[],
  documents: readonly CaseDocument[],
  options: {
    signal?: AbortSignal;
    onDocument?: (choice: AiDocumentChoice, completed: number, total: number) => void;
  } = {},
): Promise<AiDocumentChoice[]> {
  const sourceRows = await findAiSourcesByDocuments(documents.map((document) => document.id));
  const sources = new Map(sourceRows.map((source) => [source.documentId, source]));
  const caseMap = new Map(cases.map((caseItem) => [caseItem.id, caseItem]));
  const choices: AiDocumentChoice[] = [];

  for (const document of documents) {
    if (options.signal?.aborted) break;
    const caseItem = caseMap.get(document.caseId);
    if (!caseItem) continue;
    const source = sources.get(document.id) ?? null;
    const choice = await inspectDocument(caseItem, document, source, options.signal);
    choices.push(choice);
    options.onDocument?.(choice, choices.length, documents.length);
  }
  return choices;
}

async function inspectDocument(
  caseItem: Case,
  document: CaseDocument,
  source: AiDocumentChoice['source'],
  signal: AbortSignal | undefined,
): Promise<AiDocumentChoice> {
  let file: File;
  try {
    file = new File(document.filePath);
    if (!file.exists) return choice(caseItem, document, source, 'missing', false, null, false, false, 'The original local file is missing.');
  } catch {
    return choice(caseItem, document, source, 'missing', false, null, false, false, 'The original local file cannot be accessed.');
  }

  const size = Number.isSafeInteger(file.size) && file.size >= 0 ? file.size : null;
  if (document.fileType === 'IMAGE') {
    return choice(
      caseItem,
      document,
      source,
      'requires_ocr',
      true,
      size,
      true,
      true,
      'Images stay local, but local OCR is not configured yet.',
    );
  }

  if (!source) return choice(caseItem, document, null, 'not_prepared', true, size, true, true, null);
  if (source.extractionStatus === 'indexing') {
    return choice(caseItem, document, source, 'interrupted', true, size, true, true, 'Preparation did not finish and can be retried.');
  }
  if (source.extractionStatus === 'unsupported') {
    return choice(caseItem, document, source, 'unsupported', true, size, false, false, source.errorMessage);
  }
  if (source.extractionStatus === 'requires_ocr') {
    return choice(caseItem, document, source, 'requires_ocr', true, size, true, true, source.errorMessage);
  }
  if (source.extractionStatus === 'missing') {
    return choice(caseItem, document, source, 'changed', true, size, true, true, 'The file is available again and can be prepared.');
  }
  if (source.extractionStatus === 'failed') {
    return choice(caseItem, document, source, 'failed', true, size, true, true, source.errorMessage);
  }

  if (source.extractionStatus === 'pending') {
    return choice(caseItem, document, source, 'not_prepared', true, size, true, true, null);
  }

  try {
    const fingerprint = await getFileFingerprintAsync(document.filePath, signal);
    const unchanged = source.fileHash === fingerprint.hash
      && source.fileSize === fingerprint.size
      && source.parserVersion === PDF_PARSER_VERSION;
    return choice(
      caseItem,
      document,
      source,
      unchanged ? 'ready' : 'changed',
      true,
      fingerprint.size,
      true,
      true,
      unchanged ? null : 'The file or local parser changed after its last preparation.',
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    return choice(caseItem, document, source, 'failed', true, size, true, true, 'The local file could not be checked.');
  }
}

function choice(
  caseItem: Case,
  document: CaseDocument,
  source: AiDocumentChoice['source'],
  status: AiDocumentUiStatus,
  fileExists: boolean,
  fileSize: number | null,
  selectable: boolean,
  processable: boolean,
  message: string | null,
): AiDocumentChoice {
  return { caseItem, document, source, status, fileExists, fileSize, selectable, processable, message };
}
