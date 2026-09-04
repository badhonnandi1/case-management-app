export interface AiThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  caseIds: string[];
  documentIds: string[];
}

export interface CreateAiThreadInput {
  title: string;
  caseIds?: readonly string[];
  documentIds?: readonly string[];
}

export interface AiThreadSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  caseCount: number;
  documentCount: number;
  readySourceCount: number;
}
