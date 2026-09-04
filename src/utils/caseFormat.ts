import type { Case, RepresentedSide } from '../models/Case';

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
  if (side === 'PLAINTIFF') return 'বাদী';
  if (side === 'DEFENDANT') return 'বিবাদী';
  return 'পক্ষ উল্লেখ নেই';
}

export function buildCauseListLine(caseItem: Case): string {
  const court = caseItem.courtName.trim() ? `(${caseItem.courtName.trim()})` : '';
  const step = caseItem.nextStep?.trim() || 'আজকের পদক্ষেপ উল্লেখ নেই';
  return `${caseItem.caseNumber}${court} ${caseItem.caseTitle} - ${representedSideLabel(caseItem.representedSide)} - ${step}`
    .replace(/\s+/g, ' ')
    .trim();
}
