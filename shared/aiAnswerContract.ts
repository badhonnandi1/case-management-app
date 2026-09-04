export const AI_API_VERSION = 'v1' as const;
export const AI_SERVER_CONTRACT_VERSION = '2026-09-04.1' as const;

export const AI_API_LIMITS = {
  questionCharacters: 2_000,
  selectedCases: 20,
  selectedDocuments: 50,
  evidenceItems: 8,
  evidenceCharacters: 6_000,
  totalEvidenceCharacters: 24_000,
  requestBytes: 64 * 1024,
  answerCharacters: 12_000,
  warnings: 8,
} as const;

// Consent is context-specific. Changing provider tier or transmission behavior
// requires a new version so an earlier acknowledgement is never reused silently.
export const AI_CONSENT_VERSION = '2026-09-04-gemini-free-selected-excerpts-v1' as const;
export const AI_PRIVACY_POLICY_ID = 'gemini-free-selected-excerpts-2026-09-04' as const;
export const AI_PROVIDER_DISPLAY_NAME = 'Google Gemini' as const;
export const AI_FREE_TIER_PRIVACY_NOTICE = 'Only selected excerpts are sent online. This backend currently uses the Gemini API free tier, where submitted content may be used to improve Google\'s products. Do not send confidential client information unless you are authorized and accept the provider\'s terms.' as const;

export type AiLanguagePreference = 'auto' | 'bn' | 'en' | 'mixed';

export interface AiAnswerEvidenceDto {
  evidenceId: string;
  chunkId: string;
  caseId: string;
  documentId: string;
  documentName: string;
  pageStart: number;
  pageEnd: number;
  excerpt: string;
  localRank: number;
}

export interface AiAnswerRequestDto {
  requestId: string;
  threadId: string;
  question: string;
  selectedCaseIds: string[];
  selectedDocumentIds: string[];
  evidence: AiAnswerEvidenceDto[];
  language: AiLanguagePreference;
  /** Optional for compatibility with older clients; the backend default is used when absent. */
  modelId?: string;
  consent: {
    granted: true;
    version: string;
  };
}

export interface AiResolvedCitationDto {
  evidenceId: string;
  chunkId: string;
  caseId: string;
  documentId: string;
  documentName: string;
  pageStart: number;
  pageEnd: number;
  citationNumber: number;
  supportingStatement: string | null;
}

export interface AiUsageDto {
  modelName: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  durationMs: number;
}

export interface AiAnswerResponseDto {
  requestId: string;
  serverRequestId: string;
  answer: string;
  citations: AiResolvedCitationDto[];
  insufficientEvidence: boolean;
  warnings: string[];
  usage: AiUsageDto;
}

export type AiApiErrorCode =
  | 'INVALID_REQUEST'
  | 'EMPTY_SCOPE'
  | 'EMPTY_EVIDENCE'
  | 'PAYLOAD_TOO_LARGE'
  | 'CONSENT_REQUIRED'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_PROVIDER_RESPONSE'
  | 'NETWORK_UNAVAILABLE'
  | 'REQUEST_CANCELLED'
  | 'MODEL_NOT_ALLOWED'
  | 'INTERNAL_ERROR';

export const AI_API_ERROR_CODES: readonly AiApiErrorCode[] = [
  'INVALID_REQUEST', 'EMPTY_SCOPE', 'EMPTY_EVIDENCE', 'PAYLOAD_TOO_LARGE',
  'CONSENT_REQUIRED', 'UNAUTHORIZED', 'RATE_LIMITED', 'PROVIDER_NOT_CONFIGURED',
  'PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE', 'INVALID_PROVIDER_RESPONSE',
  'NETWORK_UNAVAILABLE', 'REQUEST_CANCELLED', 'MODEL_NOT_ALLOWED',
  'INTERNAL_ERROR',
];

export interface AiApiErrorResponseDto {
  error: {
    code: AiApiErrorCode;
    message: string;
    serverRequestId: string;
    retryAfterSeconds?: number;
  };
}

export interface AiSessionResponseDto {
  sessionToken: string;
  expiresAt: string;
}

export interface AiHealthResponseDto {
  status: 'ok' | 'degraded';
  apiVersion: typeof AI_API_VERSION;
  onlineAnswers: 'available' | 'provider_not_configured';
}

export interface AiPublicModelDto {
  id: string;
  displayName: string;
}

export interface AiPublicConfigDto {
  apiVersion: typeof AI_API_VERSION;
  serverContractVersion: typeof AI_SERVER_CONTRACT_VERSION;
  providerDisplayName: string;
  defaultModelId: string;
  allowedModels: AiPublicModelDto[];
  privacy: {
    policyId: string;
    consentVersion: string;
    processingTier: 'free_conservative';
    notice: string;
    selectedExcerptsOnly: true;
    originalFilesUploaded: false;
  };
  limits: {
    questionCharacters: number;
    evidenceItems: number;
  };
  features: {
    onlineAnswers: boolean;
    modelSelection: boolean;
  };
}

export function isAiAnswerResponseDto(value: unknown): value is AiAnswerResponseDto {
  if (!isRecord(value) || typeof value.requestId !== 'string' || typeof value.serverRequestId !== 'string') return false;
  if (typeof value.answer !== 'string' || typeof value.insufficientEvidence !== 'boolean') return false;
  if (!Array.isArray(value.warnings) || !value.warnings.every((item) => typeof item === 'string')) return false;
  if (!Array.isArray(value.citations) || !value.citations.every(isResolvedCitation)) return false;
  return isUsage(value.usage);
}

export function isAiApiErrorResponseDto(value: unknown): value is AiApiErrorResponseDto {
  if (!isRecord(value) || !isRecord(value.error)) return false;
  return typeof value.error.code === 'string'
    && AI_API_ERROR_CODES.includes(value.error.code as AiApiErrorCode)
    && typeof value.error.message === 'string'
    && typeof value.error.serverRequestId === 'string'
    && (value.error.retryAfterSeconds === undefined
      || (typeof value.error.retryAfterSeconds === 'number' && Number.isFinite(value.error.retryAfterSeconds)));
}

export function isAiSessionResponseDto(value: unknown): value is AiSessionResponseDto {
  return isRecord(value) && typeof value.sessionToken === 'string' && typeof value.expiresAt === 'string';
}

export function isAiHealthResponseDto(value: unknown): value is AiHealthResponseDto {
  return isRecord(value)
    && (value.status === 'ok' || value.status === 'degraded')
    && value.apiVersion === AI_API_VERSION
    && (value.onlineAnswers === 'available' || value.onlineAnswers === 'provider_not_configured');
}

export function isAiPublicConfigDto(value: unknown): value is AiPublicConfigDto {
  if (!isRecord(value)
    || value.apiVersion !== AI_API_VERSION
    || value.serverContractVersion !== AI_SERVER_CONTRACT_VERSION
    || typeof value.providerDisplayName !== 'string'
    || typeof value.defaultModelId !== 'string'
    || !Array.isArray(value.allowedModels)
    || !value.allowedModels.every(isPublicModel)
    || !isRecord(value.privacy)
    || !isRecord(value.limits)
    || !isRecord(value.features)) return false;
  const allowedIds = value.allowedModels.map((model) => model.id);
  return allowedIds.length > 0
    && new Set(allowedIds).size === allowedIds.length
    && allowedIds.includes(value.defaultModelId)
    && typeof value.privacy.policyId === 'string'
    && typeof value.privacy.consentVersion === 'string'
    && value.privacy.processingTier === 'free_conservative'
    && typeof value.privacy.notice === 'string'
    && value.privacy.selectedExcerptsOnly === true
    && value.privacy.originalFilesUploaded === false
    && value.limits.questionCharacters === AI_API_LIMITS.questionCharacters
    && value.limits.evidenceItems === AI_API_LIMITS.evidenceItems
    && typeof value.features.onlineAnswers === 'boolean'
    && typeof value.features.modelSelection === 'boolean';
}

function isPublicModel(value: unknown): value is AiPublicModelDto {
  return isRecord(value)
    && typeof value.id === 'string'
    && /^gemini-[a-z0-9.-]+$/.test(value.id)
    && typeof value.displayName === 'string'
    && value.displayName.length > 0;
}

function isResolvedCitation(value: unknown): value is AiResolvedCitationDto {
  if (!isRecord(value)) return false;
  return ['evidenceId', 'chunkId', 'caseId', 'documentId', 'documentName'].every(
    (key) => typeof value[key] === 'string' && value[key].length > 0,
  ) && Number.isInteger(value.pageStart)
    && Number.isInteger(value.pageEnd)
    && Number.isInteger(value.citationNumber)
    && (value.supportingStatement === null || typeof value.supportingStatement === 'string');
}

function isUsage(value: unknown): value is AiUsageDto {
  if (!isRecord(value) || typeof value.modelName !== 'string' || value.modelName.length === 0
    || typeof value.durationMs !== 'number' || !Number.isFinite(value.durationMs) || value.durationMs < 0) return false;
  return ['inputTokens', 'outputTokens', 'totalTokens'].every(
    (key) => value[key] === null
      || (typeof value[key] === 'number' && Number.isInteger(value[key]) && value[key] >= 0),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
