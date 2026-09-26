import { PublicApiError } from '../errors.js';

export type ProviderFailureCategory =
  | 'timeout'
  | 'rate_limit'
  | 'network'
  | 'server'
  | 'client'
  | 'safety'
  | 'invalid_response';

export class WorkerProviderError extends PublicApiError {
  provider: 'gemini' | 'groq' | null = null;
  fallbackUsed = false;

  constructor(
    code: PublicApiError['code'],
    statusCode: number,
    message: string,
    readonly category: ProviderFailureCategory,
    readonly retryable: boolean,
    retryAfterSeconds?: number,
  ) {
    super(code, statusCode, message, retryAfterSeconds);
    this.name = 'WorkerProviderError';
  }
}

export function classifyProviderResponse(status: number, retryAfter: string | null): WorkerProviderError {
  const retryAfterSeconds = parseRetryAfter(retryAfter);
  if (status === 429) {
    return new WorkerProviderError(
      'RATE_LIMITED', 429, 'The online AI service is busy. Please try again later.',
      'rate_limit', true, retryAfterSeconds ?? undefined,
    );
  }
  if (status >= 500) {
    return new WorkerProviderError(
      'PROVIDER_UNAVAILABLE', 503, 'The online AI service is temporarily unavailable.',
      'server', true, retryAfterSeconds ?? undefined,
    );
  }
  return new WorkerProviderError(
    'PROVIDER_UNAVAILABLE', 502, 'The online AI service rejected the request.',
    'client', false,
  );
}

export function classifyProviderThrown(error: unknown): WorkerProviderError {
  if (error instanceof WorkerProviderError) return error;
  if (error instanceof PublicApiError && error.code === 'INVALID_PROVIDER_RESPONSE') {
    return new WorkerProviderError(error.code, error.statusCode, error.message, 'invalid_response', false);
  }
  if (error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted'))) {
    return new WorkerProviderError(
      'PROVIDER_TIMEOUT', 504, 'The online AI service took too long to respond.', 'timeout', true,
    );
  }
  if (error instanceof TypeError) {
    return new WorkerProviderError(
      'PROVIDER_UNAVAILABLE', 503, 'The online AI service could not be reached.', 'network', true,
    );
  }
  return new WorkerProviderError(
    'PROVIDER_UNAVAILABLE', 503, 'The online AI service could not complete the request.', 'client', false,
  );
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(120, Math.ceil(seconds));
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.min(120, Math.max(0, Math.ceil((date - Date.now()) / 1_000)));
}
