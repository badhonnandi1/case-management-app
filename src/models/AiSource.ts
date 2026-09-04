export const AI_EXTRACTION_STATUSES = [
  'pending',
  'indexing',
  'ready',
  'requires_ocr',
  'unsupported',
  'missing',
  'failed',
] as const;

export type AiExtractionStatus = (typeof AI_EXTRACTION_STATUSES)[number];

export interface AiSource {
  id: string;
  caseId: string;
  documentId: string;
  fileHash: string | null;
  fileSize: number | null;
  extractionStatus: AiExtractionStatus;
  pageCount: number | null;
  extractedAt: string | null;
  parserVersion: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AiSourceState = 'absent' | 'ready' | 'outdated' | 'failed' | 'interrupted';
