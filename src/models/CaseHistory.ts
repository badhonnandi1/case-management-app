export interface CaseHistory {
  id: string;
  caseId: string;
  hearingDate: string;
  orderText: string | null;
  nextStep: string | null;
  nextDate: string | null;
  notes: string | null;
  createdAt: string;
}

export interface CreateCaseHistoryInput {
  caseId: string;
  hearingDate: string;
  orderText?: string | null;
  nextStep?: string | null;
  nextDate?: string | null;
  notes?: string | null;
}

export type RecordHearingUpdateInput = CreateCaseHistoryInput;
