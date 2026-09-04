export type CaseStatus = 'ACTIVE' | 'PENDING' | 'CLOSED';

export type CaseListFilter = 'ALL' | CaseStatus | 'TODAY' | 'UPCOMING';

export type CaseSortOption = 'NEXT_HEARING' | 'RECENTLY_UPDATED' | 'TITLE_ASC';

export type RepresentedSide = 'PLAINTIFF' | 'DEFENDANT';

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
  courtName: string;
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
  courtName: string;
  judgeName?: string | null;
  previousDate?: string | null;
  nextDate?: string | null;
  previousOrder?: string | null;
  nextStep?: string | null;
  status: CaseStatus;
  notes?: string | null;
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
