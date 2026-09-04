import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildCauseListHtml } from '../src/utils/causeList.ts';

const outputDirectory = resolve('tmp/cause-list-visuals');
mkdirSync(outputDirectory, { recursive: true });
const options = { sortBy: 'COURT', includePartyNames: true, includeJudge: true, includePreviousOrder: true, includeNextStep: true };
const base = {
  caseType: 'দেওয়ানি', caseSerial: '৪২', caseYear: '২০২৬', representedSide: 'PETITIONER',
  partyName: 'মোঃ রফিকুল ইসলাম', oppositePartyName: 'আকবর হোসেন & Company',
  courtId: 'court-visual', courtName: 'সদর সিভিল জজ আদালত', courtShortCode: 'সদর', judgeName: 'Judge রহমান',
  previousDate: '2026-09-01', nextDate: '2026-09-15', previousOrder: 'সময় মঞ্জুর; documents reviewed <safely>',
  nextStep: 'চূড়ান্ত শুনানি and evidence review', status: 'ACTIVE', notes: null,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
};
function makeCase(index) {
  return { ...base, id: `visual-${index}`, caseNumber: `দেওয়ানি ${40 + index}/২০২৬`, caseTitle: `${index % 2 ? 'আব্দুল জলিল বনাম সরকার' : 'Rahman বনাম Karim'} — ${'দীর্ঘ বাংলা মামলার নাম '.repeat(index % 4)}` };
}
for (const count of [1, 3, 28]) {
  const html = buildCauseListHtml('2026-09-15', Array.from({ length: count }, (_, index) => makeCase(index + 1)), options);
  writeFileSync(resolve(outputDirectory, `cause-list-${count}.html`), html, 'utf8');
}
console.log(outputDirectory);
