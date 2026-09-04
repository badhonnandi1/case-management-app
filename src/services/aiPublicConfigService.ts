import * as Network from 'expo-network';

import {
  isAiPublicConfigDto,
  type AiPublicConfigDto,
} from '../../shared/aiAnswerContract';
import { validateAiBackendUrl } from './aiBackendConfig';

export type AiPublicConfigErrorCode =
  | 'NOT_CONFIGURED'
  | 'INVALID_CONFIGURATION'
  | 'DEVICE_OFFLINE'
  | 'TIMED_OUT'
  | 'UNREACHABLE'
  | 'INVALID_RESPONSE';

export class AiPublicConfigError extends Error {
  constructor(readonly code: AiPublicConfigErrorCode, message: string) {
    super(message);
    this.name = 'AiPublicConfigError';
  }
}

export interface AiPublicConfigResult {
  config: AiPublicConfigDto;
  backendHost: string;
  checkedAt: string;
}

interface FetchAiPublicConfigOptions {
  backendUrl?: string;
  production?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImplementation?: typeof fetch;
  isDeviceOnline?: () => Promise<boolean>;
}

export async function fetchAiPublicConfig(
  options: FetchAiPublicConfigOptions = {},
): Promise<AiPublicConfigResult> {
  const backend = validateAiBackendUrl(
    options.backendUrl ?? process.env.EXPO_PUBLIC_AI_BACKEND_URL,
    options.production ?? !__DEV__,
  );
  if (!backend.configured) {
    throw new AiPublicConfigError(
      backend.reason === 'not_configured' ? 'NOT_CONFIGURED' : 'INVALID_CONFIGURATION',
      backend.reason === 'not_configured'
        ? 'The production AI backend URL is not configured.'
        : 'The configured AI backend URL is invalid or insecure.',
    );
  }
  const isOnline = options.isDeviceOnline ?? (async () => {
    const state = await Network.getNetworkStateAsync();
    return state.isConnected === true && state.isInternetReachable !== false;
  });
  if (!(await isOnline())) {
    throw new AiPublicConfigError('DEVICE_OFFLINE', 'This device is offline. Local AI tools remain available.');
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1_000, Math.min(15_000, options.timeoutMs ?? 5_000)));
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    const response = await (options.fetchImplementation ?? fetch)(`${backend.baseUrl}/api/v1/config`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new AiPublicConfigError('UNREACHABLE', 'The AI backend configuration is unavailable.');
    const text = await response.text();
    if (text.length > 32_768) throw new AiPublicConfigError('INVALID_RESPONSE', 'The AI backend returned an invalid configuration.');
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new AiPublicConfigError('INVALID_RESPONSE', 'The AI backend returned an invalid configuration.');
    }
    if (!isAiPublicConfigDto(value)) {
      throw new AiPublicConfigError('INVALID_RESPONSE', 'The AI backend configuration is incompatible with this app.');
    }
    return {
      config: value,
      backendHost: new URL(backend.baseUrl).host,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof AiPublicConfigError) throw error;
    if (options.signal?.aborted) throw new AiPublicConfigError('UNREACHABLE', 'The configuration check was cancelled.');
    throw new AiPublicConfigError(
      timedOut ? 'TIMED_OUT' : 'UNREACHABLE',
      timedOut ? 'The AI backend configuration check timed out.' : 'The AI backend could not be reached.',
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
  }
}
