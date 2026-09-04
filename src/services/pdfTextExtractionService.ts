import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

import type { TextPage } from '../utils/chunkText';
import { classifySelectableText } from '../utils/pdfText';

export const PDF_PARSER_VERSION = 'pdfbox-android-2.0.27.0-v1';

export type PdfExtractionStatus =
  | 'success'
  | 'requires_ocr'
  | 'empty'
  | 'password_protected'
  | 'corrupted'
  | 'unsupported'
  | 'cancelled';

export interface ExtractedPdfPage extends TextPage {
  warnings: string[];
}

export interface PdfExtractionResult {
  status: PdfExtractionStatus;
  pages: ExtractedPdfPage[];
  pageCount: number;
  parserVersion: string;
  warnings: string[];
  errorMessage: string | null;
}

export interface PdfExtractionOptions {
  signal?: AbortSignal;
  onProgress?: (completedPages: number, pageCount: number) => void;
}

interface NativePdfResult {
  status: Exclude<PdfExtractionStatus, 'requires_ocr'>;
  pages?: Array<{ pageNumber: number; text: string; warnings?: string[] }>;
  pageCount?: number;
  warnings?: string[];
  errorMessage?: string;
}

interface NativePdfExtractor {
  extract(requestId: string, uri: string): Promise<NativePdfResult>;
  cancel(requestId: string): void;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const nativeExtractor = NativeModules.LocalPdfTextExtractor as NativePdfExtractor | undefined;

export async function extractPdfText(
  uri: string,
  options: PdfExtractionOptions = {},
): Promise<PdfExtractionResult> {
  if (Platform.OS !== 'android' || !nativeExtractor) {
    return result('unsupported', [], 0, 'Local PDF extraction is unavailable on this build.');
  }
  if (options.signal?.aborted) return result('cancelled', [], 0, 'Indexing was cancelled.');
  const requestId = `pdf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emitter = new NativeEventEmitter(nativeExtractor);
  const subscription = emitter.addListener('LocalPdfTextExtractorProgress', (event: unknown) => {
    if (!isProgressEvent(event) || event.requestId !== requestId) return;
    options.onProgress?.(event.completedPages, event.pageCount);
  });
  const abort = () => nativeExtractor.cancel(requestId);
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    const nativeResult = await nativeExtractor.extract(requestId, uri);
    const pages = (nativeResult.pages ?? []).map((page) => ({
      pageNumber: page.pageNumber,
      text: page.text,
      warnings: page.warnings ?? [],
    }));
    const pageCount = nativeResult.pageCount ?? pages.length;
    if (nativeResult.status !== 'success') {
      return result(
        nativeResult.status,
        pages,
        pageCount,
        nativeResult.errorMessage ?? null,
        nativeResult.warnings ?? [],
      );
    }
    const requiresOcr = classifySelectableText(pages, pageCount) === 'requires_ocr';
    return {
      status: requiresOcr ? 'requires_ocr' : 'success',
      pages,
      pageCount,
      parserVersion: PDF_PARSER_VERSION,
      warnings: [
        ...(nativeResult.warnings ?? []),
        ...(requiresOcr ? ['Most pages contain little or no selectable text.'] : []),
      ],
      errorMessage: requiresOcr ? 'This PDF requires OCR before it can be searched.' : null,
    };
  } catch (error) {
    return result('corrupted', [], 0, safeError(error));
  } finally {
    subscription.remove();
    options.signal?.removeEventListener('abort', abort);
  }
}

function result(
  status: PdfExtractionStatus,
  pages: ExtractedPdfPage[],
  pageCount: number,
  errorMessage: string | null,
  warnings: string[] = [],
): PdfExtractionResult {
  return { status, pages, pageCount, parserVersion: PDF_PARSER_VERSION, warnings, errorMessage };
}

function safeError(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 500);
  return 'The PDF could not be read.';
}

function isProgressEvent(value: unknown): value is {
  requestId: string;
  completedPages: number;
  pageCount: number;
} {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return typeof event.requestId === 'string'
    && typeof event.completedPages === 'number'
    && typeof event.pageCount === 'number';
}
