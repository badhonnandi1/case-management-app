import assert from 'node:assert/strict';

const fileUtils = await import('../src/utils/file.ts');
const causeListUtils = await import('../src/utils/causeList.ts');
const reminderUtils = await import('../src/utils/reminder.ts');
const caseFormatUtils = await import('../src/utils/caseFormat.ts');

assert.equal(fileUtils.getFileExtension('Court Order.PDF'), '.pdf');
assert.equal(fileUtils.getFileExtension('no-extension'), '');
assert.equal(fileUtils.normalizeDisplayFilename('Court Order - Final', 'Original.pdf'), 'Court Order - Final.pdf');
assert.equal(fileUtils.normalizeDisplayFilename('Evidence.png', 'Evidence.jpg'), 'Evidence.jpg');
assert.equal(fileUtils.buildCollisionFileName('Cause_List_2026-09-15.pdf', 1), 'Cause_List_2026-09-15.pdf');
assert.equal(fileUtils.buildCollisionFileName('Cause_List_2026-09-15.pdf', 2), 'Cause_List_2026-09-15_2.pdf');

const baseCase = {
  id: 'a', caseNumber: 'Civil 2/2026', caseTitle: 'A & <B>', partyName: 'Rahman & Sons',
  caseType: 'Civil', caseSerial: '2', caseYear: '2026', representedSide: 'PLAINTIFF',
  oppositePartyName: 'Karim > Co', courtName: 'Court B', judgeName: 'Judge "One"',
  previousDate: null, nextDate: '2026-09-15', previousOrder: 'Use <evidence>', nextStep: 'Prepare > file',
  status: 'ACTIVE', notes: null, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
};
const cases = [
  baseCase,
  { ...baseCase, id: 'b', caseNumber: 'Civil 1/2026', caseTitle: 'Zeta Case', courtName: 'Court A' },
];
const options = { sortBy: 'COURT', includePartyNames: true, includeJudge: true, includePreviousOrder: true, includeNextStep: true };
assert.deepEqual(causeListUtils.sortCauseListCases(cases, options).map((item) => item.id), ['b', 'a']);
assert.deepEqual(causeListUtils.sortCauseListCases(cases, { ...options, sortBy: 'CASE_NUMBER' }).map((item) => item.id), ['b', 'a']);
assert.deepEqual(causeListUtils.sortCauseListCases(cases, { ...options, sortBy: 'CASE_TITLE' }).map((item) => item.id), ['a', 'b']);
const html = causeListUtils.buildCauseListHtml('2026-09-15', cases, options);
assert.match(html, /15 September 2026/);
assert.match(html, /2 cases/);
assert.match(html, /A &amp; &lt;B&gt;/);
assert.match(html, /Rahman &amp; Sons/);
assert.match(html, /Karim &gt; Co/);
assert.match(html, /Civil 2\/2026\(Court B\) A &amp; &lt;B&gt; - বাদী - Prepare &gt; file/);
assert.doesNotMatch(html, /A & <B>/);
assert.match(html, /\.case \+ \.case \{ border-top:/);
assert.match(html, /break-inside: avoid-page/);
assert.match(html, /@page \{ size: A4;/);
assert.doesNotMatch(html, /\.case \{[^}]*border-bottom/s);
const minimalHtml = causeListUtils.buildCauseListHtml('2026-09-15', cases, {
  ...options,
  includePartyNames: false,
  includeJudge: false,
  includePreviousOrder: false,
  includeNextStep: false,
});
assert.doesNotMatch(minimalHtml, />Party</);
assert.doesNotMatch(minimalHtml, />Judge</);
assert.doesNotMatch(minimalHtml, />Previous Order</);
assert.doesNotMatch(minimalHtml, />Next Step</);

const beforeHearing = new Date(2026, 8, 1, 8, 0, 0);
assert.equal(reminderUtils.calculateReminderDate('2026-09-15', 1, '08:00', beforeHearing)?.getTime(), new Date(2026, 8, 14, 8, 0, 0).getTime());
assert.equal(reminderUtils.calculateReminderDate('2026-09-15', 3, '08:00', beforeHearing)?.getTime(), new Date(2026, 8, 12, 8, 0, 0).getTime());
assert.equal(reminderUtils.calculateReminderDate('2026-09-15', 0, '08:00', beforeHearing)?.getTime(), new Date(2026, 8, 15, 8, 0, 0).getTime());
assert.equal(reminderUtils.calculateReminderDate('2026-09-15', 1, '08:00', new Date(2026, 8, 14, 9, 0, 0)), null);
assert.equal(reminderUtils.shouldScheduleCaseReminder({ ...baseCase, status: 'CLOSED' }, { enabled: true, daysBefore: 1, time: '08:00' }, beforeHearing), null);
assert.equal(reminderUtils.shouldScheduleCaseReminder({ ...baseCase, nextDate: null }, { enabled: true, daysBefore: 1, time: '08:00' }, beforeHearing), null);
assert.equal(reminderUtils.shouldScheduleCaseReminder(baseCase, { enabled: false, daysBefore: 1, time: '08:00' }, beforeHearing), null);
assert.equal(caseFormatUtils.buildCaseNumber('LST', '45', '22'), 'LST 45/22');
assert.deepEqual(caseFormatUtils.parseCaseNumber('LST 45/22'), { caseType: 'LST', caseSerial: '45', caseYear: '22' });
assert.equal(caseFormatUtils.buildCauseListLine({ ...baseCase, caseNumber: 'LST 45/22', courtName: 'সদর', caseTitle: 'রহিমা vs করিম', nextStep: 'চূড়ান্ত শুনানি' }), 'LST 45/22(সদর) রহিমা vs করিম - বাদী - চূড়ান্ত শুনানি');
assert.equal(caseFormatUtils.buildCauseListLine({ ...baseCase, courtShortCode: 'সদর', courtName: 'সদর সিভিল জজ আদালত' }), 'Civil 2/2026(সদর) A & <B> - বাদী - Prepare > file');

console.log('File naming, Cause List sorting/HTML escaping, and local reminder calculation contracts passed.');
