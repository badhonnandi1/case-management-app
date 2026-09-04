import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';

import type { AiUsageDto } from '../../../shared/aiAnswerContract.js';
import { PROVIDER_RESPONSE_JSON_SCHEMA, type ValidatedAnswerRequest } from '../contracts.js';
import { PublicApiError, normalizeProviderError } from '../errors.js';
import type { AiAnswerProvider, ProviderAnswerResult } from './provider.js';
import { EVIDENCE_ONLY_SYSTEM_INSTRUCTION, buildEvidencePrompt } from './promptBuilder.js';
import { parseAndResolveProviderAnswer } from './providerResponse.js';

export interface GeminiGenerator {
  generateContent(input: {
    model: string;
    contents: string;
    config: {
      systemInstruction: string;
      responseMimeType: string;
      responseJsonSchema: unknown;
      maxOutputTokens: number;
      abortSignal: AbortSignal;
    };
  }): Promise<GenerateContentResponse>;
}

export class GeminiAnswerProvider implements AiAnswerProvider {
  readonly configured: boolean;
  private readonly generator: GeminiGenerator | null;

  constructor(
    apiKey: string | null,
    generator?: GeminiGenerator,
  ) {
    this.configured = generator !== undefined || apiKey !== null;
    this.generator = generator ?? (apiKey ? new GoogleGenAI({ apiKey }).models : null);
  }

  async answer(request: ValidatedAnswerRequest, signal: AbortSignal, modelId: string): Promise<ProviderAnswerResult> {
    if (!this.generator) {
      throw new PublicApiError('PROVIDER_NOT_CONFIGURED', 503, 'Online answers are not configured on this server.');
    }
    const startedAt = performance.now();
    let lastValidationError: PublicApiError | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.generator.generateContent({
          model: modelId,
          contents: buildEvidencePrompt(request, attempt === 1 ? lastValidationError?.code : undefined),
          config: {
            systemInstruction: EVIDENCE_ONLY_SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseJsonSchema: PROVIDER_RESPONSE_JSON_SCHEMA,
            maxOutputTokens: 2_048,
            abortSignal: signal,
          },
        });
        const resolved = parseAndResolveProviderAnswer(response.text ?? '', request);
        return {
          ...resolved,
          usage: normalizeUsage(response, modelId, Math.round(performance.now() - startedAt)),
        };
      } catch (error) {
        if (error instanceof PublicApiError && error.code === 'INVALID_PROVIDER_RESPONSE' && attempt === 0) {
          lastValidationError = error;
          continue;
        }
        throw normalizeProviderError(error);
      }
    }
    throw lastValidationError ?? new PublicApiError(
      'INVALID_PROVIDER_RESPONSE',
      502,
      'The online AI returned an invalid response.',
    );
  }
}

function normalizeUsage(response: GenerateContentResponse, modelName: string, durationMs: number): AiUsageDto {
  const usage = response.usageMetadata;
  return {
    modelName,
    inputTokens: finiteNonNegative(usage?.promptTokenCount),
    outputTokens: finiteNonNegative(usage?.candidatesTokenCount),
    totalTokens: finiteNonNegative(usage?.totalTokenCount),
    durationMs,
  };
}

function finiteNonNegative(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
