export type AiMessageRole = 'system' | 'user' | 'assistant';

export interface AiMessage {
  id: string;
  threadId: string;
  role: AiMessageRole;
  content: string;
  modelName: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: number | null;
  createdAt: string;
}

export type CreateAiMessageInput = Omit<AiMessage, 'id' | 'createdAt'>;

export interface AiMessageWithCitations {
  message: AiMessage;
  citations: import('./AiCitation').AiCitation[];
}
