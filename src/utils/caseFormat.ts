import { REPRESENTED_SIDE_OPTIONS, type Case, type RepresentedSide } from '../models/Case.ts';

export function buildCaseNumber(caseType: string, caseSerial: string, caseYear: string): string {
  const type = caseType.trim();
  const serial = caseSerial.trim();
  const year = caseYear.trim();
  return `${type} ${serial}/${year}`.trim();
}

export function parseCaseNumber(caseNumber: string): {
  caseType: string;
  caseSerial: string;
  caseYear: string;
} {
  const match = /^(.+?)\s+(\S+)\/(\S+)$/.exec(caseNumber.trim());
  return match
    ? { caseType: match[1] ?? '', caseSerial: match[2] ?? '', caseYear: match[3] ?? '' }
    : { caseType: '', caseSerial: caseNumber.trim(), caseYear: '' };
}

export function representedSideLabel(side: RepresentedSide | null | undefined): string {
  return REPRESENTED_SIDE_OPTIONS.find((option) => option.value === side)?.shortLabel ?? 'পক্ষ উল্লেখ নেই';
}

export function buildCauseListLine(caseItem: Case): string {
  const courtName = caseItem.courtShortCode?.trim() || caseItem.courtName.trim();
  const court = courtName ? `(${courtName})` : '';
  const step = caseItem.nextStep?.trim() || 'আজকের পদক্ষেপ উল্লেখ নেই';
  return `${caseItem.caseNumber}${court} ${caseItem.caseTitle} - ${representedSideLabel(caseItem.representedSide)} - ${step}`
    .replace(/\s+/g, ' ')
    .trim();
}
