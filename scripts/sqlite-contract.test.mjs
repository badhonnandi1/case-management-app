import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const database = new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys = ON');
database.exec(`
  CREATE TABLE cases (
    id TEXT PRIMARY KEY NOT NULL,
    case_number TEXT NOT NULL,
    case_title TEXT NOT NULL,
    party_name TEXT NOT NULL,
    opposite_party_name TEXT NOT NULL,
    court_name TEXT NOT NULL,
    judge_name TEXT,
    previous_date TEXT,
    next_date TEXT,
    previous_order TEXT,
    next_step TEXT,
    status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'PENDING', 'CLOSED')),
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE case_history (
    id TEXT PRIMARY KEY NOT NULL,
    case_id TEXT NOT NULL,
    hearing_date TEXT NOT NULL,
    order_text TEXT,
    next_step TEXT,
    next_date TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
  );
  CREATE TABLE documents (
    id TEXT PRIMARY KEY NOT NULL,
    case_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_type TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
  );
  CREATE TABLE case_reminders (
    case_id TEXT PRIMARY KEY NOT NULL,
    notification_id TEXT NOT NULL UNIQUE,
    scheduled_for TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
  );
`);

const insertCase = database.prepare(`
  INSERT INTO cases (
    id, case_number, case_title, party_name, opposite_party_name, court_name,
    judge_name, previous_date, next_date, previous_order, next_step, status,
    notes, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function createCase(id, title, nextDate) {
  insertCase.run(
    id,
    `Case ${id}/2026`,
    title,
    `Party ${id}`,
    `Opponent ${id}`,
    'District Court',
    'Judge One',
    null,
    nextDate,
    null,
    'Prepare',
    'ACTIVE',
    null,
    '2026-09-01T00:00:00.000Z',
    '2026-09-01T00:00:00.000Z',
  );
}

function recordHearingUpdate({ id, caseId, hearingDate, orderText, nextDate, nextStep, createdAt, forceFailure = false }) {
  database.exec('BEGIN EXCLUSIVE');
  try {
    database.prepare(`
      INSERT INTO case_history (
        id, case_id, hearing_date, order_text, next_step, next_date, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, caseId, hearingDate, orderText, nextStep, nextDate, null, createdAt);

    if (forceFailure) {
      database.prepare('UPDATE cases SET missing_column = ? WHERE id = ?').run('fail', caseId);
    }

    const result = database.prepare(`
      UPDATE cases SET
        previous_date = ?, previous_order = ?, next_date = ?, next_step = ?, updated_at = ?
      WHERE id = ?
    `).run(hearingDate, orderText, nextDate, nextStep, createdAt, caseId);
    if (result.changes !== 1) throw new Error('Case update failed');
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

createCase('hearing-case', 'Rahman vs Karim', '2026-09-12');
recordHearingUpdate({
  id: 'history-1',
  caseId: 'hearing-case',
  hearingDate: '2026-09-12',
  orderText: 'Witness examination completed',
  nextDate: '2026-09-25',
  nextStep: 'Cross-examination',
  createdAt: '2026-09-12T10:00:00.000Z',
});

const updatedCase = database.prepare('SELECT * FROM cases WHERE id = ?').get('hearing-case');
assert.equal(updatedCase.previous_date, '2026-09-12');
assert.equal(updatedCase.previous_order, 'Witness examination completed');
assert.equal(updatedCase.next_date, '2026-09-25');
assert.equal(updatedCase.next_step, 'Cross-examination');
assert.equal(updatedCase.created_at, '2026-09-01T00:00:00.000Z');
assert.equal(updatedCase.updated_at, '2026-09-12T10:00:00.000Z');
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM case_history WHERE case_id = ?').get('hearing-case').count, 1);
const insertedHistory = database.prepare('SELECT * FROM case_history WHERE id = ?').get('history-1');
assert.equal(insertedHistory.order_text, 'Witness examination completed');
assert.equal(insertedHistory.next_date, '2026-09-25');
assert.equal(insertedHistory.next_step, 'Cross-examination');

createCase('rollback-case', 'Rollback Test', '2026-09-12');
assert.throws(() => recordHearingUpdate({
  id: 'rollback-history',
  caseId: 'rollback-case',
  hearingDate: '2026-09-12',
  orderText: 'Should rollback',
  nextDate: null,
  nextStep: null,
  createdAt: '2026-09-12T11:00:00.000Z',
  forceFailure: true,
}));
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM case_history WHERE id = ?').get('rollback-history').count, 0);
assert.equal(database.prepare('SELECT next_date FROM cases WHERE id = ?').get('rollback-case').next_date, '2026-09-12');

createCase('other-case', 'Unrelated Case', '2026-10-01');
recordHearingUpdate({ id: 'history-2', caseId: 'hearing-case', hearingDate: '2026-09-20', orderText: 'Second order', nextDate: '2026-10-10', nextStep: 'Arguments', createdAt: '2026-09-20T09:00:00.000Z' });
recordHearingUpdate({ id: 'history-other', caseId: 'other-case', hearingDate: '2026-09-18', orderText: 'Other order', nextDate: null, nextStep: null, createdAt: '2026-09-18T09:00:00.000Z' });
const history = database.prepare('SELECT id FROM case_history WHERE case_id = ? ORDER BY hearing_date DESC, created_at DESC').all('hearing-case');
assert.deepEqual(history.map((row) => row.id), ['history-2', 'history-1']);

createCase('calendar-a', 'Calendar A', '2026-09-15');
createCase('calendar-b', 'Calendar B', '2026-09-15');
createCase('calendar-c', 'Calendar C', '2026-09-20');
const exactDate = database.prepare('SELECT id FROM cases WHERE next_date = ? ORDER BY id').all('2026-09-15');
assert.deepEqual(exactDate.map((row) => row.id), ['calendar-a', 'calendar-b']);
const monthRows = database.prepare('SELECT next_date FROM cases WHERE next_date >= ? AND next_date <= ?').all('2026-09-01', '2026-09-30');
const monthCounts = monthRows.reduce((counts, row) => counts.set(row.next_date, (counts.get(row.next_date) ?? 0) + 1), new Map());
assert.equal(monthCounts.get('2026-09-15'), 2);
assert.equal(monthCounts.get('2026-09-20'), 1);

createCase('document-case', 'Document Case', '2026-09-28');
database.prepare(`INSERT INTO documents (
  id, case_id, file_name, file_path, file_type, description, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?)`)
  .run('document-1', 'document-case', 'Court Order.pdf', 'file:///app/cases/document-1.pdf', 'PDF', null, '2026-09-02T08:00:00.000Z');
const documents = database.prepare('SELECT * FROM documents WHERE case_id = ? ORDER BY created_at DESC').all('document-case');
assert.equal(documents.length, 1);
assert.equal(documents[0].file_name, 'Court Order.pdf');
database.prepare('UPDATE documents SET file_name = ?, description = ? WHERE id = ?')
  .run('Court Order - Final.pdf', 'Certified order', 'document-1');
const updatedDocument = database.prepare('SELECT * FROM documents WHERE id = ?').get('document-1');
assert.equal(updatedDocument.file_name, 'Court Order - Final.pdf');
assert.equal(updatedDocument.description, 'Certified order');
database.prepare('DELETE FROM documents WHERE id = ?').run('document-1');
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM documents WHERE id = ?').get('document-1').count, 0);

createCase('cascade-case', 'Cascade Case', '2026-09-30');
recordHearingUpdate({ id: 'cascade-history', caseId: 'cascade-case', hearingDate: '2026-09-30', orderText: 'Final order', nextDate: null, nextStep: null, createdAt: '2026-09-30T09:00:00.000Z' });
database.prepare('INSERT INTO documents (id, case_id, file_name, file_path, file_type, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('cascade-document', 'cascade-case', 'Evidence.jpg', 'file:///evidence.jpg', 'IMAGE', null, '2026-09-30T09:00:00.000Z');
database.prepare('INSERT INTO case_reminders (case_id, notification_id, scheduled_for, updated_at) VALUES (?, ?, ?, ?)').run('cascade-case', 'notification-1', '2026-09-29T02:00:00.000Z', '2026-09-01T00:00:00.000Z');
database.prepare('DELETE FROM cases WHERE id = ?').run('cascade-case');
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM case_history WHERE case_id = ?').get('cascade-case').count, 0);
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM documents WHERE case_id = ?').get('cascade-case').count, 0);
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM case_reminders WHERE case_id = ?').get('cascade-case').count, 0);

const repositorySource = readFileSync(new URL('../src/repositories/caseHistoryRepository.ts', import.meta.url), 'utf8');
assert.match(repositorySource, /withExclusiveTransactionAsync/);
assert.match(repositorySource, /INSERT INTO case_history/);
assert.match(repositorySource, /UPDATE cases SET/);

for (const statement of [
  'ALTER TABLE cases ADD COLUMN case_type TEXT',
  'ALTER TABLE cases ADD COLUMN case_serial TEXT',
  'ALTER TABLE cases ADD COLUMN case_year TEXT',
  "ALTER TABLE cases ADD COLUMN represented_side TEXT CHECK (represented_side IS NULL OR represented_side IN ('PLAINTIFF', 'DEFENDANT'))",
]) database.exec(statement);
database.prepare('UPDATE cases SET case_type = ?, case_serial = ?, case_year = ?, represented_side = ? WHERE id = ?')
  .run('LST', '45', '22', 'PLAINTIFF', 'hearing-case');
const structuredCase = database.prepare('SELECT case_type, case_serial, case_year, represented_side FROM cases WHERE id = ?').get('hearing-case');
assert.deepEqual({ ...structuredCase }, { case_type: 'LST', case_serial: '45', case_year: '22', represented_side: 'PLAINTIFF' });

console.log('SQLite hearing, calendar, document CRUD, reminder mapping, rollback, and delete cascade contracts passed.');
