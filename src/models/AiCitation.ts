export interface AiCitation {
  id: string;
  messageId: string;
  chunkId: string;
  documentId: string;
  pageStart: number;
  pageEnd: number;
  citationNumber: number;
}

export type CreateAiCitationInput = Omit<AiCitation, 'id' | 'messageId'>;
