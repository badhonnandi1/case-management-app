export const AI_BACKEND_WAKE_MAX_WAIT_MS = 70_000;
export const AI_BACKEND_WAKE_ATTEMPT_TIMEOUT_MS = 12_000;
export const AI_BACKEND_WAKE_RETRY_DELAY_MS = 3_000;

export interface AiBackendWakeProgress {
  attempt: number;
  elapsedMs: number;
  remainingMs: number;
}

interface PollAiBackendWakeOptions<Result> {
  probe: (timeoutMs: number, signal?: AbortSignal) => Promise<Result>;
  shouldRetry: (result: Result) => boolean;
  signal?: AbortSignal;
  maxWaitMs?: number;
  attemptTimeoutMs?: number;
  retryDelayMs?: number;
  onProgress?: (progress: AiBackendWakeProgress) => void;
}

/**
 * Performs bounded health probes only. It never invokes a session or answer endpoint,
 * so callers must require a separate user action before resending an AI question.
 */
export async function pollAiBackendWake<Result>(
  options: PollAiBackendWakeOptions<Result>,
): Promise<Result> {
  const maxWaitMs = clamp(options.maxWaitMs ?? AI_BACKEND_WAKE_MAX_WAIT_MS, 1_000, 90_000);
  const attemptTimeoutMs = clamp(
    options.attemptTimeoutMs ?? AI_BACKEND_WAKE_ATTEMPT_TIMEOUT_MS,
    1_000,
    15_000,
  );
  const retryDelayMs = clamp(options.retryDelayMs ?? AI_BACKEND_WAKE_RETRY_DELAY_MS, 0, 10_000);
  const startedAt = Date.now();
  let attempt = 0;

  while (true) {
    if (options.signal?.aborted) throw new AiBackendWakeCancelledError();
    const elapsedMs = Date.now() - startedAt;
    const remainingMs = Math.max(0, maxWaitMs - elapsedMs);
    attempt += 1;
    options.onProgress?.({ attempt, elapsedMs, remainingMs });

    const result = await options.probe(
      Math.max(1_000, Math.min(attemptTimeoutMs, remainingMs || 1_000)),
      options.signal,
    );
    if (!options.shouldRetry(result)) return result;

    const remainingAfterProbe = maxWaitMs - (Date.now() - startedAt);
    if (remainingAfterProbe <= 0) return result;
    await cancellableDelay(Math.min(retryDelayMs, remainingAfterProbe), options.signal);
  }
}

export class AiBackendWakeCancelledError extends Error {
  constructor() {
    super('The backend wake check was cancelled.');
    this.name = 'AiBackendWakeCancelledError';
  }
}

function cancellableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AiBackendWakeCancelledError());
      return;
    }
    const timeout = setTimeout(finish, delayMs);
    const cancel = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      reject(new AiBackendWakeCancelledError());
    };
    function finish() {
      signal?.removeEventListener('abort', cancel);
      resolve();
    }
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
