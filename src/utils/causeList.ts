import type { Case } from '../models/Case';
import type { CauseListOptions } from '../models/CauseList';
import { buildCauseListLine } from './caseFormat.ts';

export function escapeHtml(value: string | null | undefined): string {
  return (value?.trim() || 'Not provided')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sortCauseListCases(cases: readonly Case[], options: CauseListOptions): Case[] {
  const sorted = [...cases];
  sorted.sort((left, right) => {
    if (options.sortBy === 'CASE_NUMBER') {
      return compareText(left.caseNumber, right.caseNumber) || compareText(left.caseTitle, right.caseTitle);
    }
    if (options.sortBy === 'CASE_TITLE') {
      return compareText(left.caseTitle, right.caseTitle) || compareText(left.caseNumber, right.caseNumber);
    }
    return compareText(left.courtName, right.courtName) || compareText(left.caseTitle, right.caseTitle);
  });
  return sorted;
}

export function buildCauseListHtml(
  selectedDate: string,
  cases: readonly Case[],
  options: CauseListOptions,
): string {
  const sortedCases = sortCauseListCases(cases, options);
  const caseBlocks = sortedCases.map((caseItem, index) => {
    const optionalRows = [
      options.includePartyNames ? fieldRow('Party', caseItem.partyName) : '',
      options.includePartyNames ? fieldRow('Opposite Party', caseItem.oppositePartyName) : '',
      options.includeJudge ? fieldRow('Judge', caseItem.judgeName) : '',
      options.includePreviousOrder ? fieldRow('Previous Order', caseItem.previousOrder) : '',
    ].join('');
    return `<section class="case">
      <h2><span>${index + 1}.</span> ${escapeHtml(buildCauseListLine({
        ...caseItem,
        nextStep: options.includeNextStep ? caseItem.nextStep : null,
      }))}</h2>
      ${optionalRows}
    </section>`;
  }).join('');

  return `<!DOCTYPE html>
  <html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 14mm 13mm 15mm; }
    body { color: #17212B; font-family: Arial, sans-serif; font-size: 12px; line-height: 1.55; }
    header { border-bottom: 2px solid #173B63; margin-bottom: 24px; padding-bottom: 14px; text-align: center; }
    h1 { color: #173B63; font-size: 22px; letter-spacing: 1.2px; margin: 0 0 7px; }
    .date { font-size: 14px; font-weight: 700; margin: 0 0 4px; }
    .meta { color: #66717D; margin: 0; }
    .case { break-inside: avoid-page; page-break-inside: avoid; padding: 2px 0 22px; margin: 0; }
    .case + .case { border-top: 1.5px solid #AEB8C2; padding-top: 22px; }
    h2 { color: #17212B; font-size: 15px; line-height: 1.55; margin: 0 0 12px; overflow-wrap: anywhere; }
    h2 span { color: #173B63; }
    .row { display: flex; margin: 0 0 7px; break-inside: avoid; }
    .label { color: #66717D; flex: 0 0 110px; font-weight: 700; }
    .value { flex: 1; white-space: pre-wrap; }
    footer { color: #66717D; font-size: 10px; margin-top: 22px; text-align: center; }
  </style></head><body>
    <header><h1>DAILY CAUSE LIST</h1><p class="date">${escapeHtml(formatCauseListDate(selectedDate))}</p><p class="meta">${sortedCases.length} ${sortedCases.length === 1 ? 'case' : 'cases'} · Generated from Case Management App</p></header>
    ${caseBlocks}
    <footer>Prepared for local court-diary use</footer>
  </body></html>`;
}

export function getCauseListFileName(selectedDate: string): string {
  return `Cause_List_${selectedDate}.pdf`;
}

function fieldRow(label: string, value: string | null | undefined): string {
  return `<div class="row"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'en', { sensitivity: 'base', numeric: true });
}

function formatCauseListDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Unknown date';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
}
