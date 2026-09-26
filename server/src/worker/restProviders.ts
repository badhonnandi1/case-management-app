import type { AiUsageDto } from '../../../shared/aiAnswerContract.js';
import { PROVIDER_RESPONSE_JSON_SCHEMA, type ValidatedAnswerRequest } from '../contracts.js';
import type { ProviderAnswerResult } from '../provider/provider.js';
import { EVIDENCE_ONLY_SYSTEM_INSTRUCTION, buildEvidencePrompt } from '../provider/promptBuilder.js';
import { parseAndResolveProviderAnswer } from '../provider/providerResponse.js';
import { classifyProviderResponse, classifyProviderThrown, WorkerProviderError } from './providerErrors.js';

export type ProviderFetch = typeof fetch;

export const defaultProviderFetch: ProviderFetch = (input, init) => fetch(input, init);

export interface RestAnswerProvider {
  answer(request: ValidatedAnswerRequest, signal: AbortSignal): Promise<ProviderAnswerResult>;
}

export class GeminiRestProvider implements RestAnswerProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly publicModelName: string,
    private readonly maxOutputTokens: number,
    private readonly providerFetch: ProviderFetch = defaultProviderFetch,
  ) {}

  async answer(request: ValidatedAnswerRequest, signal: AbortSignal): Promise<ProviderAnswerResult> {
    return this.withOneStructuredRepair(request, signal);
  }

  private async withOneStructuredRepair(request: ValidatedAnswerRequest, signal: AbortSignal): Promise<ProviderAnswerResult> {
    const startedAt = performance.now();
    let repairReason: string | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.providerFetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: EVIDENCE_ONLY_SYSTEM_INSTRUCTION }] },
              contents: [{ role: 'user', parts: [{ text: buildEvidencePrompt(request, repairReason) }] }],
              generationConfig: {
                responseMimeType: 'application/json',
                responseJsonSchema: PROVIDER_RESPONSE_JSON_SCHEMA,
                maxOutputTokens: this.maxOutputTokens,
              },
            }),
            signal,
          },
        );
        if (!response.ok) throw classifyProviderResponse(response.status, response.headers.get('retry-after'));
        const body = await response.json() as GeminiResponse;
        const blockReason = body.promptFeedback?.blockReason;
        const candidate = body.candidates?.[0];
        if (blockReason || candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'RECITATION') {
          throw safetyRefusal();
        }
        const text = candidate?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
        const resolved = parseAndResolveProviderAnswer(text, request);
        return { ...resolved, usage: geminiUsage(body, this.publicModelName, startedAt) };
      } catch (error) {
        const normalized = classifyProviderThrown(error);
        if (normalized.category === 'invalid_response' && attempt === 0) {
          repairReason = normalized.code;
          continue;
        }
        throw normalized;
      }
    }
    throw invalidResponse();
  }
}

export class GroqRestProvider implements RestAnswerProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly publicModelName: string,
    private readonly maxOutputTokens: number,
    private readonly providerFetch: ProviderFetch = defaultProviderFetch,
  ) {}

  async answer(request: ValidatedAnswerRequest, signal: AbortSignal): Promise<ProviderAnswerResult> {
    const startedAt = performance.now();
    let repairReason: string | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.providerFetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: 'system', content: EVIDENCE_ONLY_SYSTEM_INSTRUCTION },
              { role: 'user', content: buildEvidencePrompt(request, repairReason) },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'evidence_answer', strict: true, schema: PROVIDER_RESPONSE_JSON_SCHEMA },
            },
            max_completion_tokens: this.maxOutputTokens,
            temperature: 0,
          }),
          signal,
        });
        if (!response.ok) throw classifyProviderResponse(response.status, response.headers.get('retry-after'));
        const body = await response.json() as GroqResponse;
        const choice = body.choices?.[0];
        if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') throw safetyRefusal();
        const resolved = parseAndResolveProviderAnswer(choice?.message?.content ?? '', request);
        return { ...resolved, usage: groqUsage(body, this.publicModelName, startedAt) };
      } catch (error) {
        const normalized = classifyProviderThrown(error);
        if (normalized.category === 'invalid_response' && attempt === 0) {
          repairReason = normalized.code;
          continue;
        }
        throw normalized;
      }
    }
    throw invalidResponse();
  }
}

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
}

interface GroqResponse {
  choices?: Array<{ finish_reason?: string; message?: { content?: string; refusal?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

function geminiUsage(body: GeminiResponse, modelName: string, startedAt: number): AiUsageDto {
  return {
    modelName,
    inputTokens: token(body.usageMetadata?.promptTokenCount),
    outputTokens: token(body.usageMetadata?.candidatesTokenCount),
    totalTokens: token(body.usageMetadata?.totalTokenCount),
    durationMs: duration(startedAt),
  };
}

function groqUsage(body: GroqResponse, modelName: string, startedAt: number): AiUsageDto {
  return {
    modelName,
    inputTokens: token(body.usage?.prompt_tokens),
    outputTokens: token(body.usage?.completion_tokens),
    totalTokens: token(body.usage?.total_tokens),
    durationMs: duration(startedAt),
  };
}

function token(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function duration(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function invalidResponse(): WorkerProviderError {
  return new WorkerProviderError(
    'INVALID_PROVIDER_RESPONSE', 502, 'The online AI returned an invalid response.',
    'invalid_response', false,
  );
}

function safetyRefusal(): WorkerProviderError {
  return new WorkerProviderError(
    'PROVIDER_UNAVAILABLE', 422, 'The online AI could not answer this request under its safety policy.',
    'safety', false,
  );
}
