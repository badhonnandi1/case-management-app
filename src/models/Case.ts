export type CaseStatus = 'ACTIVE' | 'PENDING' | 'CLOSED';

export type CaseListFilter = 'ALL' | CaseStatus | 'TODAY' | 'UPCOMING';

export type CaseSortOption = 'NEXT_HEARING' | 'RECENTLY_UPDATED' | 'TITLE_ASC';

import type { PaymentStatus } from './CaseHistory';

export const REPRESENTED_SIDE_OPTIONS = [
  { value: 'PLAINTIFF', label: 'Plaintiff (বাদী)', shortLabel: 'বাদী' },
  { value: 'DEFENDANT', label: 'Defendant (বিবাদী)', shortLabel: 'বিবাদী' },
  { value: 'PETITIONER', label: 'Petitioner (আবেদনকারী)', shortLabel: 'আবেদনকারী' },
  { value: 'APPELLANT', label: 'Appellant (আপিলকারী)', shortLabel: 'আপিলকারী' },
  { value: 'RESPONDENT', label: 'Respondent (প্রতিবাদী)', shortLabel: 'প্রতিবাদী' },
  { value: 'REVISIONER', label: 'Revisioner (রিভিশনকারী)', shortLabel: 'রিভিশনকারী' },
  { value: 'OPPONENT', label: 'Opponent (প্রতিপক্ষ)', shortLabel: 'প্রতিপক্ষ' },
  { value: 'DECREE_HOLDER', label: 'Decree Holder (ডিক্রিধারী)', shortLabel: 'ডিক্রিধারী' },
  { value: 'JUDGMENT_DEBTOR', label: 'Judgment Debtor (জাজমেন্ট দেনাদার)', shortLabel: 'জাজমেন্ট দেনাদার' },
  { value: 'FIRST_PARTY', label: 'First Party (১ম পক্ষ)', shortLabel: '১ম পক্ষ' },
  { value: 'SECOND_PARTY', label: 'Second Party (২য় পক্ষ)', shortLabel: '২য় পক্ষ' },
  { value: 'STATE', label: 'State (রাষ্ট্র)', shortLabel: 'রাষ্ট্র' },
  { value: 'ACCUSED', label: 'Accused (আসামি)', shortLabel: 'আসামি' },
] as const;

export type RepresentedSide = typeof REPRESENTED_SIDE_OPTIONS[number]['value'];

export interface Case {
  id: string;
  caseNumber: string;
  caseType: string | null;
  caseSerial: string | null;
  caseYear: string | null;
  caseTitle: string;
  partyName: string;
  oppositePartyName: string;
  representedSide: RepresentedSide | null;
  courtId: string | null;
  courtName: string;
  courtShortCode: string | null;
  judgeName: string | null;
  previousDate: string | null;
  nextDate: string | null;
  previousOrder: string | null;
  nextStep: string | null;
  status: CaseStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCaseInput {
  caseNumber: string;
  caseType?: string | null;
  caseSerial?: string | null;
  caseYear?: string | null;
  caseTitle: string;
  partyName: string;
  oppositePartyName: string;
  representedSide?: RepresentedSide | null;
  courtId?: string | null;
  courtName: string;
  judgeName?: string | null;
  previousDate?: string | null;
  nextDate?: string | null;
  previousOrder?: string | null;
  nextStep?: string | null;
  status: CaseStatus;
  notes?: string | null;
  previousPaymentStatus?: PaymentStatus | null;
  previousPaymentAmountMinor?: number | null;
  previousPaymentNote?: string | null;
}

export type UpdateCaseInput = Partial<CreateCaseInput>;

export interface CaseCounts {
  today: number;
  upcoming: number;
  active: number;
  total: number;
}

export interface CaseQueryOptions {
  search?: string;
  filter?: CaseListFilter;
  sort?: CaseSortOption;
  today?: string;
}
