import type { AiApiErrorCode } from '../../shared/aiAnswerContract.js';

export class PublicApiError extends Error {
  constructor(
    public readonly code: AiApiErrorCode,
    public readonly statusCode: number,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'PublicApiError';
  }
}

export function normalizeProviderError(error: unknown): PublicApiError {
  if (error instanceof PublicApiError) return error;
  if (error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('aborted'))) {
    return new PublicApiError('PROVIDER_TIMEOUT', 504, 'The online AI service took too long to respond.');
  }
  const status = readStatus(error);
  if (status === 429) return new PublicApiError('RATE_LIMITED', 429, 'The online AI service is busy. Please try again later.');
  if (status !== null && status >= 500) {
    return new PublicApiError('PROVIDER_UNAVAILABLE', 503, 'The online AI service is temporarily unavailable.');
  }
  return new PublicApiError('PROVIDER_UNAVAILABLE', 503, 'The online AI service could not complete the request.');
}

function readStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const record = error as Record<string, unknown>;
  for (const key of ['status', 'statusCode', 'code']) {
    if (typeof record[key] === 'number') return record[key];
  }
  return null;
}
