import type { AiSearchResult } from './AiChunk';
import type { AiMessageWithCitations } from './AiMessage';
import type { AiThread } from './AiThread';
import type { Case } from './Case';
import type { CaseDocument } from './CaseDocument';
import type { AiDocumentChoice } from './AiUi';

export interface PreparedAiConversationEvidence {
  thread: AiThread;
  caseIds: string[];
  documentIds: string[];
  readyDocumentIds: string[];
  evidence: AiSearchResult[];
  scopeChanged: boolean;
  unavailableDocumentCount: number;
}

export interface RestoredAiConversation {
  thread: AiThread;
  messages: AiMessageWithCitations[];
  cases: Case[];
  documents: CaseDocument[];
  choices: AiDocumentChoice[];
  readySourceCount: number;
  scopeChanged: boolean;
}
