import { AI_API_LIMITS, type AiApiErrorCode } from '../../shared/aiAnswerContract';

export type AiQuestionValidation =
  | { valid: true; question: string }
  | { valid: false; message: string };

export function validateAiQuestion(value: string): AiQuestionValidation {
  const question = value.trim();
  if (!question) return { valid: false, message: 'Enter a question before sending.' };
  if (question.length > AI_API_LIMITS.questionCharacters) {
    return { valid: false, message: `Questions can contain at most ${AI_API_LIMITS.questionCharacters} characters.` };
  }
  return { valid: true, question };
}

export function isAiRequestActive(phase: string): boolean {
  return [
    'chat_retrieving',
    'chat_preparing',
    'chat_awaiting_consent',
    'chat_connecting',
    'chat_generating',
    'chat_validating',
    'chat_saving',
  ].includes(phase);
}

export function aiRequestPhaseLabel(phase: string): string | null {
  const labels: Record<string, string> = {
    chat_retrieving: 'Searching selected sources locally',
    chat_preparing: 'Preparing selected excerpts',
    chat_awaiting_consent: 'Waiting for consent',
    chat_connecting: 'Connecting securely',
    chat_generating: 'Generating answer',
    chat_validating: 'Validating citations',
    chat_saving: 'Saving locally',
  };
  return labels[phase] ?? null;
}

export function safeAiRequestError(code: AiApiErrorCode, retryAfterSeconds?: number): string {
  const retryLater = retryAfterSeconds ? ` Try again in about ${Math.ceil(retryAfterSeconds)} seconds.` : '';
  const messages: Record<AiApiErrorCode, string> = {
    INVALID_REQUEST: 'The question or selected excerpts could not be prepared safely.',
    EMPTY_SCOPE: 'Select at least one case and one document.',
    EMPTY_EVIDENCE: 'No relevant text was found in the prepared sources.',
    PAYLOAD_TOO_LARGE: 'The question or selected excerpts exceed the online request limit.',
    CONSENT_REQUIRED: 'Review and accept the online data notice before sending excerpts.',
    UNAUTHORIZED: 'The anonymous online session expired. Please retry.',
    RATE_LIMITED: `The online service is rate limited.${retryLater}`,
    PROVIDER_NOT_CONFIGURED: 'The online answer provider is not configured.',
    PROVIDER_TIMEOUT: 'The online answer timed out. Your question was not saved. Start the AI service, wait for the connection check to succeed, then retry manually.',
    PROVIDER_UNAVAILABLE: 'The online answer provider is temporarily unavailable.',
    INVALID_PROVIDER_RESPONSE: 'The online answer failed citation validation and was not saved.',
    NETWORK_UNAVAILABLE: 'The device or AI backend is offline. Local search is still available. If the backend is sleeping, start it and retry only after the connection check succeeds.',
    REQUEST_CANCELLED: 'The request was cancelled. Your question remains in the composer.',
    MODEL_NOT_ALLOWED: 'The selected AI model is no longer available. Refresh AI settings and retry.',
    INTERNAL_ERROR: 'The online answer could not be completed. Your question was not saved.',
  };
  return messages[code];
}

export function inferAiQuestionLanguage(value: string): 'bn' | 'en' | 'mixed' | 'auto' {
  const hasBangla = /[\u0980-\u09FF]/u.test(value);
  const hasEnglish = /[A-Za-z]/u.test(value);
  if (hasBangla && hasEnglish) return 'mixed';
  if (hasBangla) return 'bn';
  if (hasEnglish) return 'en';
  return 'auto';
}

export function isCurrentAiRequestSequence(
  requestSequence: number,
  activeSequence: number,
  aborted: boolean,
): boolean {
  return requestSequence === activeSequence && !aborted;
}
