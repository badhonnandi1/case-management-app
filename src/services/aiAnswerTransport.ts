import {
  isAiAnswerResponseDto,
  isAiApiErrorResponseDto,
  isAiSessionResponseDto,
  type AiAnswerRequestDto,
  type AiAnswerResponseDto,
  type AiApiErrorCode,
  type AiSessionResponseDto,
} from '../../shared/aiAnswerContract';
import { validateAiBackendUrl } from './aiBackendConfig';

export class AiAnswerApiError extends Error {
  readonly code: AiApiErrorCode;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    code: AiApiErrorCode,
    message: string,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.name = 'AiAnswerApiError';
  }
}

export interface AiAnswerTransportOptions {
  backendUrl: string | undefined;
  production: boolean;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
  isDeviceOnline?: () => Promise<boolean>;
}

export interface AiAnswerTransport {
  send(request: AiAnswerRequestDto, signal?: AbortSignal): Promise<AiAnswerResponseDto>;
}

export function createAiAnswerTransport(options: AiAnswerTransportOptions): AiAnswerTransport {
  const config = validateAiBackendUrl(options.backendUrl, options.production);
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const isDeviceOnline = options.isDeviceOnline ?? (async () => true);
  const timeoutMs = Math.max(1_000, Math.min(120_000, options.timeoutMs ?? 35_000));
  let session: AiSessionResponseDto | null = null;

  return {
    async send(request, signal) {
      if (!config.configured) {
        throw new AiAnswerApiError('PROVIDER_NOT_CONFIGURED', backendConfigurationMessage(config.reason));
      }
      if (!(await isDeviceOnline())) {
        throw new AiAnswerApiError('NETWORK_UNAVAILABLE', 'This device is offline. Local preparation and search remain available.');
      }
      if (!session || Date.parse(session.expiresAt) <= Date.now() + 5_000) {
        session = await createSession(config.baseUrl, fetchImplementation, timeoutMs, signal);
      }
      try {
        return await sendAnswer(config.baseUrl, request, session.sessionToken, fetchImplementation, timeoutMs, signal);
      } catch (error) {
        if (!(error instanceof AiAnswerApiError) || error.code !== 'UNAUTHORIZED') throw error;
        session = await createSession(config.baseUrl, fetchImplementation, timeoutMs, signal);
        return sendAnswer(config.baseUrl, request, session.sessionToken, fetchImplementation, timeoutMs, signal);
      }
    },
  };
}

async function createSession(
  baseUrl: string,
  fetchImplementation: typeof fetch,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<AiSessionResponseDto> {
  const response = await requestWithTimeout(
    fetchImplementation,
    `${baseUrl}/api/v1/sessions`,
    { method: 'POST', headers: { accept: 'application/json' } },
    timeoutMs,
    signal,
  );
  const body = await parseResponseBody(response);
  if (!response.ok) throw apiErrorFromResponse(response.status, body);
  if (!isAiSessionResponseDto(body) || !body.sessionToken || !Number.isFinite(Date.parse(body.expiresAt))) {
    throw new AiAnswerApiError('INVALID_PROVIDER_RESPONSE', 'The AI server returned an invalid session response.');
  }
  return body;
}

async function sendAnswer(
  baseUrl: string,
  request: AiAnswerRequestDto,
  sessionToken: string,
  fetchImplementation: typeof fetch,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<AiAnswerResponseDto> {
  const response = await requestWithTimeout(fetchImplementation, `${baseUrl}/api/v1/answers`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${sessionToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
  }, timeoutMs, signal);
  const body = await parseResponseBody(response);
  if (!response.ok) throw apiErrorFromResponse(response.status, body);
  if (!isAiAnswerResponseDto(body) || !responseMatchesRequest(body, request)) {
    throw new AiAnswerApiError('INVALID_PROVIDER_RESPONSE', 'The AI server returned an invalid answer response.');
  }
  return body;
}

async function requestWithTimeout(
  fetchImplementation: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  if (externalSignal?.aborted) throw new AiAnswerApiError('REQUEST_CANCELLED', 'The online request was cancelled.');
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const cancel = () => controller.abort();
  externalSignal?.addEventListener('abort', cancel, { once: true });
  try {
    return await fetchImplementation(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (externalSignal?.aborted) throw new AiAnswerApiError('REQUEST_CANCELLED', 'The online request was cancelled.');
    if (timedOut) throw new AiAnswerApiError('PROVIDER_TIMEOUT', 'The online request timed out.');
    throw new AiAnswerApiError('NETWORK_UNAVAILABLE', 'The AI server could not be reached. Local features are still available.');
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', cancel);
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > 256 * 1024) throw new AiAnswerApiError('INVALID_PROVIDER_RESPONSE', 'The AI server response is too large.');
  try {
    return JSON.parse(text);
  } catch {
    throw new AiAnswerApiError('INVALID_PROVIDER_RESPONSE', 'The AI server returned an unreadable response.');
  }
}

function apiErrorFromResponse(status: number, body: unknown): AiAnswerApiError {
  if (isAiApiErrorResponseDto(body)) {
    return new AiAnswerApiError(body.error.code, safeMessage(body.error.code), body.error.retryAfterSeconds);
  }
  if (status === 401) return new AiAnswerApiError('UNAUTHORIZED', safeMessage('UNAUTHORIZED'));
  if (status === 429) return new AiAnswerApiError('RATE_LIMITED', safeMessage('RATE_LIMITED'));
  if (status === 413) return new AiAnswerApiError('PAYLOAD_TOO_LARGE', safeMessage('PAYLOAD_TOO_LARGE'));
  return new AiAnswerApiError('INTERNAL_ERROR', safeMessage('INTERNAL_ERROR'));
}

function responseMatchesRequest(response: AiAnswerResponseDto, request: AiAnswerRequestDto): boolean {
  if (response.requestId !== request.requestId || response.answer.trim().length === 0) return false;
  if (!response.insufficientEvidence && response.citations.length === 0) return false;
  const evidenceById = new Map(request.evidence.map((item) => [item.evidenceId, item]));
  const citationNumbers = new Set<number>();
  for (const [index, citation] of response.citations.entries()) {
    const evidence = evidenceById.get(citation.evidenceId);
    if (!evidence || citationNumbers.has(citation.citationNumber) || citation.citationNumber !== index + 1) return false;
    citationNumbers.add(citation.citationNumber);
    if (citation.chunkId !== evidence.chunkId || citation.caseId !== evidence.caseId
      || citation.documentId !== evidence.documentId || citation.documentName !== evidence.documentName
      || citation.pageStart !== evidence.pageStart || citation.pageEnd !== evidence.pageEnd) return false;
  }
  return true;
}

function backendConfigurationMessage(reason: 'not_configured' | 'invalid_url' | 'insecure_url'): string {
  if (reason === 'not_configured') return 'Online answers are not configured in this app build.';
  if (reason === 'insecure_url') return 'The configured AI server URL is not secure.';
  return 'The configured AI server URL is invalid.';
}

function safeMessage(code: AiApiErrorCode): string {
  const messages: Record<AiApiErrorCode, string> = {
    INVALID_REQUEST: 'The online answer request is invalid.',
    EMPTY_SCOPE: 'Select at least one case and one document.',
    EMPTY_EVIDENCE: 'No relevant local excerpts are available.',
    PAYLOAD_TOO_LARGE: 'The online answer request is too large.',
    CONSENT_REQUIRED: 'Consent is required before excerpts can be sent.',
    UNAUTHORIZED: 'The anonymous online session expired.',
    RATE_LIMITED: 'Too many online requests. Please try again later.',
    PROVIDER_NOT_CONFIGURED: 'Online answers are not configured on the server.',
    PROVIDER_TIMEOUT: 'The online AI service took too long to respond.',
    PROVIDER_UNAVAILABLE: 'The online AI service is temporarily unavailable.',
    INVALID_PROVIDER_RESPONSE: 'The online AI service returned an invalid response.',
    NETWORK_UNAVAILABLE: 'The AI server could not be reached.',
    REQUEST_CANCELLED: 'The online request was cancelled.',
    MODEL_NOT_ALLOWED: 'The selected AI model is no longer allowed. Refresh AI settings.',
    INTERNAL_ERROR: 'The online request could not be completed.',
  };
  return messages[code];
}
