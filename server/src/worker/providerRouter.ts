import type { ValidatedAnswerRequest } from '../contracts.js';
import type { ProviderAnswerResult } from '../provider/provider.js';
import type { WorkerConfig } from './config.js';
import { WorkerProviderError } from './providerErrors.js';
import {
  defaultProviderFetch,
  GeminiRestProvider,
  GroqRestProvider,
  type ProviderFetch,
  type RestAnswerProvider,
} from './restProviders.js';
import type { WorkerSecurityStore } from './securityStore.js';

export interface RoutedProviderResult {
  result: ProviderAnswerResult;
  provider: 'gemini' | 'groq';
  fallbackUsed: boolean;
}

export class WorkerProviderRouter {
  private readonly gemini: RestAnswerProvider | null;
  private readonly groq: RestAnswerProvider | null;

  constructor(
    private readonly config: WorkerConfig,
    private readonly store: WorkerSecurityStore,
    providerFetch: ProviderFetch = defaultProviderFetch,
    providers?: { gemini?: RestAnswerProvider | null; groq?: RestAnswerProvider | null },
  ) {
    this.gemini = providers?.gemini !== undefined
      ? providers.gemini
      : config.geminiApiKey
        ? new GeminiRestProvider(config.geminiApiKey, config.geminiModel, config.publicModelName, config.maxOutputTokens, providerFetch)
        : null;
    this.groq = providers?.groq !== undefined
      ? providers.groq
      : config.groqApiKey
        ? new GroqRestProvider(config.groqApiKey, config.groqFallbackModel, config.publicModelName, config.maxOutputTokens, providerFetch)
        : null;
  }

  async answer(request: ValidatedAnswerRequest, signal: AbortSignal, nowSeconds: number): Promise<RoutedProviderResult> {
    if (!this.gemini) throw unavailableConfiguration();
    const primaryCircuitOpen = await this.store.isCircuitOpen('gemini', nowSeconds);
    if (!primaryCircuitOpen) {
      try {
        const result = await this.callWithTimeout(this.gemini, request, signal);
        await this.store.recordProviderSuccess('gemini', nowSeconds);
        return { result, provider: 'gemini', fallbackUsed: false };
      } catch (error) {
        if (!(error instanceof WorkerProviderError) || !error.retryable) throw markRoute(error, 'gemini', false);
        await this.store.recordRetryableProviderFailure({
          provider: 'gemini', nowSeconds, retryAfterSeconds: error.retryAfterSeconds ?? null,
          threshold: this.config.circuitFailureThreshold, openSeconds: this.config.circuitOpenSeconds,
        });
        if (!this.config.fallbackEnabled || !this.groq) throw markRoute(error, 'gemini', false);
      }
    } else if (!this.config.fallbackEnabled || !this.groq) {
      throw markRoute(new WorkerProviderError(
        'PROVIDER_UNAVAILABLE', 503, 'The online AI service is temporarily unavailable.', 'server', true,
      ), 'gemini', false);
    }

    if (await this.store.isCircuitOpen('groq', nowSeconds)) {
      throw markRoute(new WorkerProviderError(
        'PROVIDER_UNAVAILABLE', 503, 'The online AI service is temporarily unavailable.', 'server', true,
      ), 'groq', true);
    }
    try {
      const result = await this.callWithTimeout(this.groq, request, signal);
      await this.store.recordProviderSuccess('groq', nowSeconds);
      return { result, provider: 'groq', fallbackUsed: true };
    } catch (error) {
      if (error instanceof WorkerProviderError && error.retryable) {
        await this.store.recordRetryableProviderFailure({
          provider: 'groq', nowSeconds, retryAfterSeconds: error.retryAfterSeconds ?? null,
          threshold: this.config.circuitFailureThreshold, openSeconds: this.config.circuitOpenSeconds,
        });
      }
      throw markRoute(error, 'groq', true);
    }
  }

  private async callWithTimeout(
    provider: RestAnswerProvider,
    request: ValidatedAnswerRequest,
    parentSignal: AbortSignal,
  ): Promise<ProviderAnswerResult> {
    if (parentSignal.aborted) {
      throw new WorkerProviderError('REQUEST_CANCELLED', 499, 'The request was cancelled.', 'client', false);
    }
    const controller = new AbortController();
    let timedOut = false;
    const abortFromParent = () => controller.abort();
    parentSignal.addEventListener('abort', abortFromParent, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.providerTimeoutMs);
    try {
      return await provider.answer(request, controller.signal);
    } catch (error) {
      if (parentSignal.aborted) {
        throw new WorkerProviderError('REQUEST_CANCELLED', 499, 'The request was cancelled.', 'client', false);
      }
      if (timedOut) {
        throw new WorkerProviderError(
          'PROVIDER_TIMEOUT', 504, 'The online AI service took too long to respond.', 'timeout', true,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      parentSignal.removeEventListener('abort', abortFromParent);
    }
  }
}

function unavailableConfiguration(): WorkerProviderError {
  return new WorkerProviderError(
    'PROVIDER_NOT_CONFIGURED', 503, 'Online answers are not configured on this server.', 'client', false,
  );
}

function markRoute(error: unknown, provider: 'gemini' | 'groq', fallbackUsed: boolean): unknown {
  if (error instanceof WorkerProviderError) {
    error.provider = provider;
    error.fallbackUsed = fallbackUsed;
  }
  return error;
}
