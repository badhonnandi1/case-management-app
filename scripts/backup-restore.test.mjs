import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const backupUtils = await import('../src/utils/backup.ts');
const storageUtils = await import('../src/utils/storage.ts');

const caseRecord = {
  id: 'case-1', caseNumber: 'Civil 42/2026', caseTitle: 'Rahman vs Karim',
  caseType: 'Civil', caseSerial: '42', caseYear: '2026', representedSide: 'PLAINTIFF',
  partyName: 'Rahman', oppositePartyName: 'Karim', courtName: 'District Court',
  judgeName: null, previousDate: '2026-08-20', nextDate: '2026-09-15',
  previousOrder: 'Adjourned', nextStep: 'Arguments', status: 'ACTIVE', notes: null,
  createdAt: '2026-08-01T08:00:00.000Z', updatedAt: '2026-09-01T08:00:00.000Z',
};
const historyRecord = {
  id: 'history-1', caseId: 'case-1', hearingDate: '2026-08-20',
  orderText: 'Adjourned', nextStep: 'Arguments', nextDate: '2026-09-15', notes: null,
  createdAt: '2026-08-20T08:00:00.000Z',
};
const portablePath = backupUtils.buildPortableDocumentPath('case-1', 'document-1', 'Order.PDF');
assert.equal(portablePath, 'documents/cases/case-1/document-1.pdf');
assert.equal(
  backupUtils.buildRestoredDocumentFileName('restore-abc', 'document-1', portablePath),
  'restore-abc-document-1.pdf',
);
assert.equal(backupUtils.isSafeBackupArchivePath(portablePath), true);
assert.equal(backupUtils.isSafeBackupArchivePath('../database.sqlite'), false);
assert.equal(backupUtils.isSafeBackupArchivePath('documents/../../secret'), false);

const backupData = {
  cases: [caseRecord],
  caseHistory: [historyRecord],
  documents: [{
    id: 'document-1', caseId: 'case-1', fileName: 'Order.pdf', archivePath: portablePath,
    fileType: 'PDF', description: 'Certified copy', createdAt: '2026-08-20T09:00:00.000Z',
  }],
  settings: [{ id: 'setting-1', key: 'reminders_enabled', value: 'true', updatedAt: '2026-09-01T08:00:00.000Z' }],
};
const manifest = backupUtils.createBackupManifest(backupData, '1.0.0', 2, '2026-09-02T08:30:00.000Z');
assert.equal(manifest.backupFormatVersion, 1);
assert.equal(manifest.caseCount, 1);
assert.equal(manifest.historyCount, 1);
assert.equal(manifest.documentCount, 1);

const roundTrip = backupUtils.validateBackupBundle(
  JSON.parse(backupUtils.serializeBackupJson(manifest)),
  JSON.parse(backupUtils.serializeBackupJson(backupData)),
  2,
);
assert.equal(roundTrip.data.cases[0].id, caseRecord.id);
assert.equal(roundTrip.data.cases[0].nextDate, caseRecord.nextDate);
assert.equal(roundTrip.data.cases[0].status, caseRecord.status);
assert.equal(roundTrip.data.cases[0].caseSerial, '42');
assert.equal(roundTrip.data.cases[0].representedSide, 'PLAINTIFF');
assert.equal(roundTrip.data.caseHistory[0].caseId, caseRecord.id);
assert.equal(roundTrip.data.documents[0].caseId, caseRecord.id);

assert.throws(
  () => backupUtils.validateBackupBundle({ ...manifest, backupFormatVersion: 99 }, backupData, 2),
  /not supported/i,
);
assert.throws(
  () => backupUtils.validateBackupBundle(manifest, { ...backupData, cases: [{ ...caseRecord, status: 'UNKNOWN' }] }, 2),
  /invalid case status/i,
);
assert.throws(
  () => backupUtils.validateBackupBundle(manifest, { ...backupData, caseHistory: [{ ...historyRecord, caseId: 'missing-case' }] }, 2),
  /missing case/i,
);

assert.equal(storageUtils.formatFileSize(0), '0 B');
assert.equal(storageUtils.formatFileSize(1024), '1.0 KB');
assert.equal(storageUtils.formatFileSize(15 * 1024 * 1024), '15 MB');
const physical = [
  { uri: 'file:///cases/document-1.pdf', size: 100 },
  { uri: 'file:///cases/orphan.jpg', size: 250 },
];
assert.deepEqual(
  storageUtils.findOrphanFiles(physical, ['file:///cases/document-1.pdf']),
  [{ uri: 'file:///cases/orphan.jpg', size: 250 }],
);
assert.deepEqual(
  storageUtils.findMissingDocumentUris(physical, ['file:///cases/document-1.pdf', 'file:///cases/missing.pdf']),
  ['file:///cases/missing.pdf'],
);

const database = new DatabaseSync(':memory:');
database.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE cases (id TEXT PRIMARY KEY, case_number TEXT NOT NULL, case_title TEXT NOT NULL,
    party_name TEXT NOT NULL, opposite_party_name TEXT NOT NULL, court_name TEXT NOT NULL,
    judge_name TEXT, previous_date TEXT, next_date TEXT, previous_order TEXT, next_step TEXT,
    status TEXT NOT NULL CHECK (status IN ('ACTIVE','PENDING','CLOSED')), notes TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE case_history (id TEXT PRIMARY KEY, case_id TEXT NOT NULL, hearing_date TEXT NOT NULL,
    order_text TEXT, next_step TEXT, next_date TEXT, notes TEXT, created_at TEXT NOT NULL,
    FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE);
  CREATE TABLE documents (id TEXT PRIMARY KEY, case_id TEXT NOT NULL, file_name TEXT NOT NULL,
    file_path TEXT NOT NULL, file_type TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL,
    FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE);
  CREATE TABLE settings (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, value TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE case_reminders (case_id TEXT PRIMARY KEY, notification_id TEXT NOT NULL UNIQUE,
    scheduled_for TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE);
`);
const insertCase = database.prepare(`INSERT INTO cases VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
insertCase.run('old-case', 'Old/1', 'Old Case', 'Old Party', '', 'Old Court', null, null, null, null, null, 'ACTIVE', null, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
database.prepare('INSERT INTO case_reminders VALUES (?, ?, ?, ?)').run('old-case', 'device-notification-id', '2026-09-10T02:00:00.000Z', '2026-09-01T00:00:00.000Z');

assert.throws(() => {
  database.exec('BEGIN EXCLUSIVE');
  try {
    database.exec('DELETE FROM case_reminders; DELETE FROM documents; DELETE FROM case_history; DELETE FROM cases; DELETE FROM settings;');
    insertCase.run('invalid-case', 'Invalid/1', 'Invalid Case', 'Party', '', 'Court', null, null, null, null, null, 'INVALID', null, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
});
assert.equal(database.prepare('SELECT COUNT(*) count FROM cases WHERE id = ?').get('old-case').count, 1);
assert.equal(database.prepare('SELECT notification_id FROM case_reminders WHERE case_id = ?').get('old-case').notification_id, 'device-notification-id');

database.exec('BEGIN EXCLUSIVE');
try {
  database.exec('DELETE FROM case_reminders; DELETE FROM documents; DELETE FROM case_history; DELETE FROM cases; DELETE FROM settings;');
  insertCase.run(caseRecord.id, caseRecord.caseNumber, caseRecord.caseTitle, caseRecord.partyName, caseRecord.oppositePartyName, caseRecord.courtName, caseRecord.judgeName, caseRecord.previousDate, caseRecord.nextDate, caseRecord.previousOrder, caseRecord.nextStep, caseRecord.status, caseRecord.notes, caseRecord.createdAt, caseRecord.updatedAt);
  database.prepare('INSERT INTO case_history VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(historyRecord.id, historyRecord.caseId, historyRecord.hearingDate, historyRecord.orderText, historyRecord.nextStep, historyRecord.nextDate, historyRecord.notes, historyRecord.createdAt);
  const portableDocument = backupData.documents[0];
  database.prepare('INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?)').run(portableDocument.id, portableDocument.caseId, portableDocument.fileName, 'file:///new-device/cases/case-1/restored-document.pdf', portableDocument.fileType, portableDocument.description, portableDocument.createdAt);
  database.prepare('INSERT INTO settings VALUES (?, ?, ?, ?)').run('setting-1', 'reminders_enabled', 'true', '2026-09-01T08:00:00.000Z');
  database.exec('COMMIT');
} catch (error) {
  database.exec('ROLLBACK');
  throw error;
}

assert.equal(database.prepare('SELECT COUNT(*) count FROM cases WHERE id = ?').get('old-case').count, 0);
assert.equal(database.prepare('SELECT id FROM cases').get().id, 'case-1');
assert.equal(database.prepare('SELECT case_id FROM case_history').get().case_id, 'case-1');
assert.equal(database.prepare('SELECT id, file_path FROM documents').get().id, 'document-1');
assert.match(database.prepare('SELECT file_path FROM documents').get().file_path, /new-device/);
assert.equal(database.prepare('SELECT COUNT(*) count FROM case_reminders').get().count, 0);
assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);

const restoreRepositorySource = readFileSync(new URL('../src/repositories/backupRepository.ts', import.meta.url), 'utf8');
assert.match(restoreRepositorySource, /withExclusiveTransactionAsync/);
assert.match(restoreRepositorySource, /DELETE FROM case_reminders/);
assert.doesNotMatch(restoreRepositorySource, /INSERT INTO case_reminders/);
const backupServiceSource = readFileSync(new URL('../src/services/backupService.ts', import.meta.url), 'utf8');
assert.doesNotMatch(backupServiceSource, /getAllCaseReminders/);
assert.match(backupServiceSource, /syncScheduledReminders/);

console.log('Backup manifest, validation, round-trip, storage health, and transactional restore contracts passed.');
