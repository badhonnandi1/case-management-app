import * as Network from 'expo-network';

import { isAiHealthResponseDto } from '../../shared/aiAnswerContract';
import {
  pollAiBackendWake,
  type AiBackendWakeProgress,
} from '../utils/aiBackendWake';
import { validateAiBackendUrl } from './aiBackendConfig';

export type AiBackendAvailability =
  | { status: 'device_offline' }
  | { status: 'not_configured' }
  | { status: 'invalid_configuration' }
  | { status: 'backend_unreachable' }
  | { status: 'healthy' }
  | { status: 'provider_not_configured' }
  | { status: 'timed_out' }
  | { status: 'invalid_response' };

export async function checkAiBackendAvailability(
  timeoutMs = 5_000,
  externalSignal?: AbortSignal,
): Promise<AiBackendAvailability> {
  if (externalSignal?.aborted) return { status: 'backend_unreachable' };
  const config = validateAiBackendUrl(process.env.EXPO_PUBLIC_AI_BACKEND_URL, !__DEV__);
  if (!config.configured) {
    return { status: config.reason === 'not_configured' ? 'not_configured' : 'invalid_configuration' };
  }
  const network = await Network.getNetworkStateAsync();
  if (network.isConnected !== true || network.isInternetReachable === false) return { status: 'device_offline' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, Math.min(15_000, timeoutMs)));
  const cancel = () => controller.abort();
  externalSignal?.addEventListener('abort', cancel, { once: true });
  try {
    const response = await fetch(`${config.baseUrl}/health`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return { status: 'backend_unreachable' };
    const text = await response.text();
    if (text.length > 16_384) return { status: 'invalid_response' };
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return { status: 'invalid_response' };
    }
    if (!isAiHealthResponseDto(value)) return { status: 'invalid_response' };
    return value.onlineAnswers === 'available' ? { status: 'healthy' } : { status: 'provider_not_configured' };
  } catch {
    return controller.signal.aborted ? { status: 'timed_out' } : { status: 'backend_unreachable' };
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', cancel);
  }
}

interface WakeAiBackendOptions {
  signal?: AbortSignal;
  maxWaitMs?: number;
  attemptTimeoutMs?: number;
  retryDelayMs?: number;
  onProgress?: (progress: AiBackendWakeProgress) => void;
  probe?: typeof checkAiBackendAvailability;
}

export async function wakeAiBackendAvailability(
  options: WakeAiBackendOptions = {},
): Promise<AiBackendAvailability> {
  const probe = options.probe ?? checkAiBackendAvailability;
  return pollAiBackendWake({
    probe,
    shouldRetry: (result) => result.status === 'backend_unreachable' || result.status === 'timed_out',
    signal: options.signal,
    maxWaitMs: options.maxWaitMs,
    attemptTimeoutMs: options.attemptTimeoutMs,
    retryDelayMs: options.retryDelayMs,
    onProgress: options.onProgress,
  });
}
