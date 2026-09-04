export type PaymentStatus = 'PAID' | 'UNPAID';

export interface CaseHistory {
  id: string;
  caseId: string;
  hearingDate: string;
  orderText: string | null;
  nextStep: string | null;
  nextDate: string | null;
  notes: string | null;
  paymentStatus: PaymentStatus | null;
  paymentAmountMinor: number | null;
  paymentNote: string | null;
  createdAt: string;
}

export interface CreateCaseHistoryInput {
  caseId: string;
  hearingDate: string;
  orderText?: string | null;
  nextStep?: string | null;
  nextDate?: string | null;
  notes?: string | null;
  paymentStatus?: PaymentStatus | null;
  paymentAmountMinor?: number | null;
  paymentNote?: string | null;
}

export type RecordHearingUpdateInput = CreateCaseHistoryInput;
