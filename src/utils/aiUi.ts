import type { Case } from '../models/Case';
import type {
  AiDocumentChoice,
  AiDocumentUiStatus,
  AiPreparationItem,
  AiPreparationSummary,
} from '../models/AiUi';

export interface AiDocumentGroup {
  caseItem: Case;
  choices: AiDocumentChoice[];
}

export type AiAssistantPhase =
  | 'home'
  | 'case_selection'
  | 'document_selection'
  | 'preparing'
  | 'ready'
  | 'search'
  | 'chat_loading'
  | 'chat_ready'
  | 'chat_retrieving'
  | 'chat_preparing'
  | 'chat_awaiting_consent'
  | 'chat_connecting'
  | 'chat_generating'
  | 'chat_validating'
  | 'chat_saving'
  | 'chat_completed'
  | 'chat_cancelled'
  | 'chat_request_error'
  | 'sources_invalidated'
  | 'error';

export interface AiAssistantState {
  phase: AiAssistantPhase;
  selectedCaseIds: string[];
  selectedDocumentIds: string[];
  threadId: string | null;
  threadTitle: string | null;
  recoverTo: Exclude<AiAssistantPhase, 'error'>;
  errorMessage: string | null;
  requestMessage: string | null;
  readySourceCount: number;
  scopeChanged: boolean;
}

export type AiAssistantAction =
  | { type: 'START_SELECTION' }
  | { type: 'SET_CASES'; caseIds: readonly string[] }
  | { type: 'SET_DOCUMENTS'; documentIds: readonly string[] }
  | { type: 'START_PREPARING' }
  | { type: 'SOURCES_READY'; threadId: string; title: string }
  | { type: 'CHAT_RESTORED'; readySourceCount: number }
  | { type: 'START_CHAT_REQUEST' }
  | { type: 'LOCAL_EVIDENCE_FOUND' }
  | { type: 'EVIDENCE_READY'; needsConsent: boolean }
  | { type: 'CONSENT_GRANTED' }
  | { type: 'REQUEST_SENT' }
  | { type: 'RESPONSE_RECEIVED' }
  | { type: 'VALIDATION_PASSED' }
  | { type: 'EXCHANGE_SAVED' }
  | { type: 'REQUEST_CANCELLED'; message?: string }
  | { type: 'REQUEST_FAILED'; message: string }
  | { type: 'SOURCES_INVALIDATED'; message: string }
  | { type: 'RESET_CHAT_REQUEST' }
  | { type: 'UPDATE_CHAT_SCOPE'; caseIds: readonly string[]; documentIds: readonly string[]; readySourceCount: number; changed: boolean }
  | { type: 'RENAME_THREAD'; title: string }
  | { type: 'OPEN_SEARCH' }
  | { type: 'CLOSE_SEARCH' }
  | { type: 'CHANGE_SOURCES' }
  | { type: 'EDIT_DOCUMENTS' }
  | { type: 'OPEN_THREAD'; threadId: string; title: string; caseIds: readonly string[]; documentIds: readonly string[]; ready: boolean }
  | { type: 'GO_HOME' }
  | { type: 'FAIL'; message: string; recoverTo?: Exclude<AiAssistantPhase, 'error'> }
  | { type: 'RECOVER' };

export const initialAiAssistantState: AiAssistantState = {
  phase: 'home',
  selectedCaseIds: [],
  selectedDocumentIds: [],
  threadId: null,
  threadTitle: null,
  recoverTo: 'home',
  errorMessage: null,
  requestMessage: null,
  readySourceCount: 0,
  scopeChanged: false,
};

export function aiAssistantReducer(
  state: AiAssistantState,
  action: AiAssistantAction,
): AiAssistantState {
  switch (action.type) {
    case 'START_SELECTION':
      return { ...initialAiAssistantState, phase: 'case_selection', recoverTo: 'case_selection' };
    case 'SET_CASES': {
      const selectedCaseIds = uniqueIds(action.caseIds);
      return {
        ...state,
        phase: selectedCaseIds.length > 0 ? 'document_selection' : 'case_selection',
        selectedCaseIds,
        recoverTo: 'case_selection',
        errorMessage: null,
        scopeChanged: state.scopeChanged || Boolean(state.threadId && !sameIds(state.selectedCaseIds, selectedCaseIds)),
      };
    }
    case 'SET_DOCUMENTS': {
      const selectedDocumentIds = uniqueIds(action.documentIds);
      return {
        ...state,
        selectedDocumentIds,
        recoverTo: 'document_selection',
        errorMessage: null,
        scopeChanged: state.scopeChanged || Boolean(state.threadId && !sameIds(state.selectedDocumentIds, selectedDocumentIds)),
      };
    }
    case 'START_PREPARING':
      if (state.selectedCaseIds.length === 0 || state.selectedDocumentIds.length === 0) return state;
      return { ...state, phase: 'preparing', recoverTo: 'document_selection', errorMessage: null };
    case 'SOURCES_READY':
      return {
        ...state,
        phase: 'chat_loading',
        threadId: action.threadId,
        threadTitle: action.title,
        recoverTo: 'chat_ready',
        errorMessage: null,
        requestMessage: null,
      };
    case 'CHAT_RESTORED':
      if (!state.threadId) return state;
      return {
        ...state,
        phase: 'chat_ready',
        recoverTo: 'chat_ready',
        readySourceCount: Math.max(0, action.readySourceCount),
        errorMessage: null,
        requestMessage: null,
      };
    case 'START_CHAT_REQUEST':
      if (!state.threadId || state.selectedCaseIds.length === 0 || state.selectedDocumentIds.length === 0
        || state.readySourceCount === 0 || !isStableChatPhase(state.phase)) return state;
      return { ...state, phase: 'chat_retrieving', requestMessage: null, recoverTo: 'chat_ready' };
    case 'EVIDENCE_READY':
      if (state.phase !== 'chat_preparing') return state;
      return { ...state, phase: action.needsConsent ? 'chat_awaiting_consent' : 'chat_connecting' };
    case 'LOCAL_EVIDENCE_FOUND':
      return state.phase === 'chat_retrieving' ? { ...state, phase: 'chat_preparing' } : state;
    case 'CONSENT_GRANTED':
      return state.phase === 'chat_awaiting_consent' ? { ...state, phase: 'chat_connecting' } : state;
    case 'REQUEST_SENT':
      return state.phase === 'chat_connecting' ? { ...state, phase: 'chat_generating' } : state;
    case 'RESPONSE_RECEIVED':
      return state.phase === 'chat_generating' ? { ...state, phase: 'chat_validating' } : state;
    case 'VALIDATION_PASSED':
      return state.phase === 'chat_validating' ? { ...state, phase: 'chat_saving' } : state;
    case 'EXCHANGE_SAVED':
      return state.phase === 'chat_saving'
        ? { ...state, phase: 'chat_completed', requestMessage: null, recoverTo: 'chat_ready' }
        : state;
    case 'REQUEST_CANCELLED':
      return isActiveChatPhase(state.phase)
        ? { ...state, phase: 'chat_cancelled', requestMessage: action.message ?? 'The request was cancelled. Your question remains in the composer.' }
        : state;
    case 'REQUEST_FAILED':
      return isActiveChatPhase(state.phase)
        ? { ...state, phase: 'chat_request_error', requestMessage: action.message }
        : state;
    case 'SOURCES_INVALIDATED':
      return {
        ...state,
        phase: 'sources_invalidated',
        readySourceCount: 0,
        requestMessage: action.message,
        recoverTo: 'chat_ready',
      };
    case 'RESET_CHAT_REQUEST':
      return isStableChatPhase(state.phase)
        ? { ...state, phase: 'chat_ready', requestMessage: null, recoverTo: 'chat_ready' }
        : state;
    case 'UPDATE_CHAT_SCOPE':
      return {
        ...state,
        selectedCaseIds: uniqueIds(action.caseIds),
        selectedDocumentIds: uniqueIds(action.documentIds),
        readySourceCount: Math.max(0, action.readySourceCount),
        scopeChanged: state.scopeChanged || action.changed,
      };
    case 'RENAME_THREAD':
      return { ...state, threadTitle: action.title, errorMessage: null };
    case 'OPEN_SEARCH':
      return state.threadId && !isActiveChatPhase(state.phase)
        ? { ...state, phase: 'search', recoverTo: 'chat_ready' }
        : state;
    case 'CLOSE_SEARCH':
      return { ...state, phase: 'chat_ready', recoverTo: 'chat_ready', errorMessage: null };
    case 'CHANGE_SOURCES':
      return { ...state, phase: 'case_selection', recoverTo: 'case_selection', errorMessage: null };
    case 'EDIT_DOCUMENTS':
      return state.selectedCaseIds.length > 0
        ? { ...state, phase: 'document_selection', recoverTo: 'document_selection', errorMessage: null }
        : { ...state, phase: 'case_selection', recoverTo: 'case_selection', errorMessage: null };
    case 'OPEN_THREAD': {
      const selectedCaseIds = uniqueIds(action.caseIds);
      const selectedDocumentIds = uniqueIds(action.documentIds);
      const phase = selectedCaseIds.length === 0
        ? 'case_selection'
        : action.ready && selectedDocumentIds.length > 0 ? 'chat_loading' : 'document_selection';
      return {
        phase,
        selectedCaseIds,
        selectedDocumentIds,
        threadId: action.threadId,
        threadTitle: action.title,
        recoverTo: phase,
        errorMessage: null,
        requestMessage: null,
        readySourceCount: action.ready ? 1 : 0,
        scopeChanged: false,
      };
    }
    case 'GO_HOME':
      return initialAiAssistantState;
    case 'FAIL':
      return {
        ...state,
        phase: 'error',
        recoverTo: action.recoverTo ?? (state.phase === 'error' ? state.recoverTo : state.phase),
        errorMessage: action.message,
      };
    case 'RECOVER':
      return { ...state, phase: state.recoverTo, errorMessage: null };
    default:
      return state;
  }
}

function isActiveChatPhase(phase: AiAssistantPhase): boolean {
  return phase === 'chat_retrieving'
    || phase === 'chat_preparing'
    || phase === 'chat_awaiting_consent'
    || phase === 'chat_connecting'
    || phase === 'chat_generating'
    || phase === 'chat_validating'
    || phase === 'chat_saving';
}

function isStableChatPhase(phase: AiAssistantPhase): boolean {
  return phase === 'chat_ready'
    || phase === 'chat_completed'
    || phase === 'chat_cancelled'
    || phase === 'chat_request_error';
}

export function toggleSelectedId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
}

export function selectFilteredIds(
  selectedIds: readonly string[],
  filteredIds: readonly string[],
): string[] {
  return uniqueIds([...selectedIds, ...filteredIds]);
}

export function selectEligibleDocumentIds(
  selectedIds: readonly string[],
  choices: readonly AiDocumentChoice[],
  caseId?: string,
): string[] {
  const eligible = choices
    .filter((choice) => choice.selectable && (!caseId || choice.document.caseId === caseId))
    .map((choice) => choice.document.id);
  return uniqueIds([...selectedIds, ...eligible]);
}

export function groupAiDocumentsByCase(
  cases: readonly Case[],
  choices: readonly AiDocumentChoice[],
): AiDocumentGroup[] {
  const grouped = new Map<string, AiDocumentChoice[]>();
  for (const choice of choices) {
    const current = grouped.get(choice.document.caseId) ?? [];
    current.push(choice);
    grouped.set(choice.document.caseId, current);
  }
  return cases.map((caseItem) => ({
    caseItem,
    choices: grouped.get(caseItem.id) ?? [],
  }));
}

export function retryableDocumentIds(items: readonly AiPreparationItem[]): string[] {
  return items
    .filter((item) => item.status === 'failed' || item.status === 'cancelled')
    .map((item) => item.documentId);
}

export function summarizePreparation(items: readonly AiPreparationItem[]): AiPreparationSummary {
  const summary: AiPreparationSummary = {
    ready: 0,
    reused: 0,
    requiresOcr: 0,
    failed: 0,
    missing: 0,
    unsupported: 0,
    cancelled: 0,
  };
  for (const item of items) {
    if (item.status === 'ready') summary.ready += 1;
    else if (item.status === 'reused') summary.reused += 1;
    else if (item.status === 'requires_ocr') summary.requiresOcr += 1;
    else if (item.status === 'failed') summary.failed += 1;
    else if (item.status === 'missing') summary.missing += 1;
    else if (item.status === 'unsupported') summary.unsupported += 1;
    else if (item.status === 'cancelled') summary.cancelled += 1;
  }
  return summary;
}

export function createDefaultThreadTitle(cases: readonly Case[], date = new Date()): string {
  if (cases.length === 1) return cases[0]?.caseNumber.trim() || cases[0]?.caseTitle.trim() || 'Prepared Sources';
  if (cases.length > 1) return `${cases.length} Cases · ${date.toLocaleDateString()}`;
  return `Prepared Sources · ${date.toLocaleDateString()}`;
}

export function aiDocumentStatusLabel(status: AiDocumentUiStatus): string {
  const labels: Record<AiDocumentUiStatus, string> = {
    checking: 'Checking file…',
    not_prepared: 'Not prepared',
    ready: 'Ready — will be reused',
    changed: 'Changed — needs re-indexing',
    preparing: 'Preparing',
    interrupted: 'Interrupted — retry available',
    requires_ocr: 'Requires OCR',
    missing: 'Missing file',
    unsupported: 'Unsupported',
    failed: 'Failed — retry available',
  };
  return labels[status];
}

export function formatAiFileSize(size: number | null): string {
  if (size === null || !Number.isFinite(size) || size < 0) return 'Size unavailable';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatCitationPages(pageStart: number, pageEnd: number): string {
  return pageStart === pageEnd ? `Page ${pageStart}` : `Pages ${pageStart}–${pageEnd}`;
}

export function createSearchExcerpt(content: string, maximum = 420): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maximum) return normalized;
  return `${normalized.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`;
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const values = new Set(left);
  return right.every((value) => values.has(value));
}
