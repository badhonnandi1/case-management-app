export interface AiChunk {
  id: string;
  sourceId: string;
  caseId: string;
  documentId: string;
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  content: string;
  createdAt: string;
}

export type NewAiChunk = Omit<AiChunk, 'id' | 'sourceId' | 'caseId' | 'documentId' | 'createdAt'>;

export interface AiSearchResult {
  chunkId: string;
  caseId: string;
  documentId: string;
  documentName: string;
  pageStart: number;
  pageEnd: number;
  content: string;
  rank: number;
}
