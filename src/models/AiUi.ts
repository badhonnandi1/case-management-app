import type { Case } from './Case';
import type { CaseDocument } from './CaseDocument';
import type { AiSource } from './AiSource';
import type { AiIndexStage } from '../services/aiIndexService';

export type AiDocumentUiStatus =
  | 'checking'
  | 'not_prepared'
  | 'ready'
  | 'changed'
  | 'preparing'
  | 'interrupted'
  | 'requires_ocr'
  | 'missing'
  | 'unsupported'
  | 'failed';

export interface AiDocumentChoice {
  document: CaseDocument;
  caseItem: Case;
  source: AiSource | null;
  status: AiDocumentUiStatus;
  fileExists: boolean;
  fileSize: number | null;
  selectable: boolean;
  processable: boolean;
  message: string | null;
}

export type AiPreparationStatus =
  | 'queued'
  | 'preparing'
  | 'ready'
  | 'reused'
  | 'requires_ocr'
  | 'missing'
  | 'unsupported'
  | 'failed'
  | 'cancelled';

export interface AiPreparationItem {
  documentId: string;
  documentName: string;
  status: AiPreparationStatus;
  stage: AiIndexStage | null;
  completedPages: number;
  pageCount: number | null;
  message: string | null;
}

export interface AiPreparationSummary {
  ready: number;
  reused: number;
  requiresOcr: number;
  failed: number;
  missing: number;
  unsupported: number;
  cancelled: number;
}
