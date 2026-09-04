import { getDocumentById } from '../repositories/documentRepository';
import {
  classifyAiSource,
  findAiSourceByDocument,
  markAiSourceIndexing,
  markAiSourceUnsearchable,
  recordAiSourceStatus,
  recoverInterruptedAiSources,
} from '../repositories/aiSourceRepository';
import { replaceDocumentChunksAtomically } from '../repositories/aiChunkRepository';
import { chunkPages, normalizeExtractedPages } from '../utils/chunkText';
import { getFileFingerprintAsync } from '../utils/contentHash';
import { extractPdfText, PDF_PARSER_VERSION } from './pdfTextExtractionService';

export type AiIndexStage = 'validating' | 'hashing' | 'extracting' | 'chunking' | 'saving' | 'complete' | 'skipped';

export interface AiIndexProgress {
  documentId: string;
  stage: AiIndexStage;
  completedPages?: number;
  pageCount?: number;
}

export interface AiIndexOptions {
  signal?: AbortSignal;
  onProgress?: (progress: AiIndexProgress) => void;
}

export type AiIndexResult =
  | { status: 'ready'; chunkCount: number; pageCount: number }
  | { status: 'skipped'; reason: 'unchanged' }
  | { status: 'requires_ocr' | 'unsupported' | 'missing' | 'failed' | 'cancelled'; message: string };

export async function recoverInterruptedIndexing(): Promise<number> {
  return recoverInterruptedAiSources();
}

export async function indexDocument(
  documentId: string,
  options: AiIndexOptions = {},
): Promise<AiIndexResult> {
  options.onProgress?.({ documentId, stage: 'validating' });
  const document = await getDocumentById(documentId);
  if (!document) return { status: 'missing', message: 'The document record no longer exists.' };
  options.onProgress?.({ documentId, stage: 'hashing' });
  let fingerprint;
  try {
    throwIfCancelled(options.signal);
    fingerprint = await getFileFingerprintAsync(document.filePath, options.signal);
  } catch (error) {
    const message = safeError(error);
    const status = options.signal?.aborted ? 'failed' : 'missing';
    await recordAiSourceStatus({
      caseId: document.caseId, documentId, status, parserVersion: PDF_PARSER_VERSION,
      errorMessage: message,
    });
    return options.signal?.aborted
      ? { status: 'cancelled', message: 'Indexing was cancelled.' }
      : { status: 'missing', message };
  }


  if (document.fileType === 'IMAGE') {
    const message = 'This image requires local OCR before it can be searched. OCR is not configured.';
    await recordAiSourceStatus({
      caseId: document.caseId,
      documentId,
      status: 'requires_ocr',
      parserVersion: PDF_PARSER_VERSION,
      fileHash: fingerprint.hash,
      fileSize: fingerprint.size,
      errorMessage: message,
    });
    return { status: 'requires_ocr', message };
  }

  const existing = await findAiSourceByDocument(documentId);
  if (classifyAiSource(existing, fingerprint.hash, PDF_PARSER_VERSION) === 'ready') {
    options.onProgress?.({ documentId, stage: 'skipped' });
    return { status: 'skipped', reason: 'unchanged' };
  }

  const source = await markAiSourceIndexing({
    caseId: document.caseId,
    documentId,
    fileHash: fingerprint.hash,
    fileSize: fingerprint.size,
    parserVersion: PDF_PARSER_VERSION,
  });

  try {
    throwIfCancelled(options.signal);
    options.onProgress?.({ documentId, stage: 'extracting' });
    const extraction = await extractPdfText(document.filePath, {
      signal: options.signal,
      onProgress: (completedPages, pageCount) => options.onProgress?.({
        documentId, stage: 'extracting', completedPages, pageCount,
      }),
    });
    throwIfCancelled(options.signal);
    if (extraction.status !== 'success') {
      const persistedStatus = extraction.status === 'requires_ocr' || extraction.status === 'empty'
        ? 'requires_ocr'
        : extraction.status === 'unsupported' || extraction.status === 'password_protected'
          ? 'unsupported'
          : extraction.status === 'cancelled' ? 'failed' : 'failed';
      const message = extraction.errorMessage
        ?? (extraction.status === 'empty' ? 'The PDF has no pages or selectable text.' : 'PDF extraction did not complete.');
      await markAiSourceUnsearchable(documentId, persistedStatus, message, extraction.pageCount);
      if (extraction.status === 'empty' || extraction.status === 'requires_ocr') {
        return { status: 'requires_ocr', message };
      }
      if (extraction.status === 'password_protected' || extraction.status === 'unsupported') {
        return { status: 'unsupported', message };
      }
      if (extraction.status === 'cancelled') return { status: 'cancelled', message };
      return { status: 'failed', message };
    }

    options.onProgress?.({ documentId, stage: 'chunking', pageCount: extraction.pageCount });
    const pages = normalizeExtractedPages(extraction.pages);
    const chunks = chunkPages(pages);
    if (chunks.length === 0) {
      const message = 'The PDF contains no searchable selectable text and requires OCR.';
      await markAiSourceUnsearchable(documentId, 'requires_ocr', message, extraction.pageCount);
      return { status: 'requires_ocr', message };
    }
    throwIfCancelled(options.signal);
    options.onProgress?.({ documentId, stage: 'saving', pageCount: extraction.pageCount });
    await replaceDocumentChunksAtomically({
      sourceId: source.id,
      caseId: document.caseId,
      documentId,
      fileHash: fingerprint.hash,
      fileSize: fingerprint.size,
      parserVersion: PDF_PARSER_VERSION,
      pageCount: extraction.pageCount,
      chunks,
    });
    options.onProgress?.({ documentId, stage: 'complete', pageCount: extraction.pageCount });
    return { status: 'ready', chunkCount: chunks.length, pageCount: extraction.pageCount };
  } catch (error) {
    const cancelled = options.signal?.aborted === true;
    const message = cancelled ? 'Indexing was cancelled before completion.' : safeError(error);
    await markAiSourceUnsearchable(documentId, 'failed', message);
    return cancelled ? { status: 'cancelled', message } : { status: 'failed', message };
  }
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('Indexing cancelled.');
}

function safeError(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 500);
  return 'Document indexing failed.';
}
