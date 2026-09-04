import * as Network from 'expo-network';

import type { AiAnswerResponseDto } from '../../shared/aiAnswerContract';
import type { AiSearchResult } from '../models/AiChunk';
import { createId } from '../utils/id';
import { prepareAiAnswerRequest, type PrepareAiAnswerRequestInput } from '../utils/aiAnswerRequest';
import { createAiAnswerTransport } from './aiAnswerTransport';

export interface SendOnlineAiAnswerInput extends Omit<PrepareAiAnswerRequestInput, 'requestId' | 'retrievalResults'> {
  requestId?: string;
  retrievalResults: readonly AiSearchResult[];
  signal?: AbortSignal;
}

const transport = createAiAnswerTransport({
  backendUrl: process.env.EXPO_PUBLIC_AI_BACKEND_URL,
  production: !__DEV__,
  isDeviceOnline: async () => {
    const state = await Network.getNetworkStateAsync();
    return state.isConnected === true && state.isInternetReachable !== false;
  },
});

export async function sendOnlineAiAnswer(input: SendOnlineAiAnswerInput): Promise<AiAnswerResponseDto> {
  const request = prepareAiAnswerRequest({
    requestId: input.requestId ?? createId(),
    threadId: input.threadId,
    question: input.question,
    selectedCaseIds: input.selectedCaseIds,
    selectedDocumentIds: input.selectedDocumentIds,
    retrievalResults: input.retrievalResults,
    language: input.language,
    modelId: input.modelId,
    consentVersion: input.consentVersion,
    consentGranted: input.consentGranted,
  });
  return transport.send(request, input.signal);
}
