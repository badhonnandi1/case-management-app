export type DocumentFileType = 'PDF' | 'IMAGE';

export interface CaseDocument {
  id: string;
  caseId: string;
  fileName: string;
  filePath: string;
  fileType: DocumentFileType;
  description: string | null;
  createdAt: string;
}

export interface CreateCaseDocumentInput {
  caseId: string;
  fileName: string;
  filePath: string;
  fileType: DocumentFileType;
  description?: string | null;
}

export interface UpdateCaseDocumentInput {
  fileName?: string;
  description?: string | null;
}
