import type {
  AiResolvedCitationDto,
  AiUsageDto,
} from '../../../shared/aiAnswerContract.js';
import type { ValidatedAnswerRequest } from '../contracts.js';

export interface ProviderAnswerResult {
  answer: string;
  citations: AiResolvedCitationDto[];
  insufficientEvidence: boolean;
  warnings: string[];
  usage: AiUsageDto;
}

export interface AiAnswerProvider {
  readonly configured: boolean;
  answer(request: ValidatedAnswerRequest, signal: AbortSignal, modelId: string): Promise<ProviderAnswerResult>;
}
