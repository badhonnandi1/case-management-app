export type CauseListSort = 'COURT' | 'CASE_NUMBER' | 'CASE_TITLE';

export interface CauseListOptions {
  sortBy: CauseListSort;
  includePartyNames: boolean;
  includeJudge: boolean;
  includePreviousOrder: boolean;
  includeNextStep: boolean;
}

export interface GeneratedCauseList {
  uri: string;
  fileName: string;
  caseCount: number;
  pageCount: number;
}
