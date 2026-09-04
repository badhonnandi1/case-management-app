import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { INITIAL_SCHEMA_STATEMENTS } from '../src/database/schema.ts';
import { caseRemindersMigration } from '../src/database/migrations/002_case_reminders.ts';
import { caseNumberAndSideMigration } from '../src/database/migrations/003_case_number_and_side.ts';
import { aiAssistantMigration } from '../src/database/migrations/004_ai_assistant.ts';
import { offlineCaseToolsMigration } from '../src/database/migrations/005_offline_case_tools.ts';
import { REPRESENTED_SIDE_OPTIONS } from '../src/models/Case.ts';
import { parsePaymentAmountMinor, formatPaymentAmountMinor } from '../src/utils/payment.ts';

const migrations = [
  { version: 1, name: 'initial_schema', statements: INITIAL_SCHEMA_STATEMENTS },
  caseRemindersMigration,
  caseNumberAndSideMigration,
  aiAssistantMigration,
  offlineCaseToolsMigration,
];

function createThrough(version) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON; CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  for (const migration of migrations.filter((item) => item.version <= version)) apply(db, migration);
  return db;
}

function apply(db, migration, extraStatement) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const statement of migration.statements) db.exec(statement);
    if (extraStatement) db.exec(extraStatement);
    db.prepare('INSERT INTO _migrations VALUES (?, ?, ?)').run(migration.version, migration.name, '2026-09-04T00:00:00.000Z');
    db.exec(`PRAGMA user_version = ${migration.version}; COMMIT`);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function insertCase(db, id, representedSide = 'PLAINTIFF', courtId = null, courtName = 'Legacy Court') {
  db.prepare(`INSERT INTO cases (
    id, case_number, case_title, party_name, opposite_party_name, represented_side,
    represented_role, court_id, court_name, status, created_at, updated_at
  ) VALUES (?, ?, ?, 'Party', 'Opponent', ?, ?, ?, ?, 'ACTIVE', ?, ?)`)
    .run(id, `Civil ${id}/2026`, `${id} title`, representedSide === 'PLAINTIFF' || representedSide === 'DEFENDANT' ? representedSide : null, representedSide, courtId, courtName, '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z');
}

// Fresh install and v4 -> v5 upgrade preserve existing records.
{
  const db = createThrough(5);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 5);
  for (const table of ['courts', 'case_tasks']) assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
  assert.ok(db.prepare("SELECT name FROM pragma_table_info('case_history') WHERE name='payment_status'").get());
  assert.ok(db.prepare("SELECT name FROM pragma_table_info('cases') WHERE name='represented_role'").get());
}
{
  const db = createThrough(4);
  db.prepare(`INSERT INTO cases (id, case_number, case_title, party_name, opposite_party_name, court_name, status, created_at, updated_at) VALUES ('preserved', 'C 1/26', 'Preserved মামলা', 'বাদী', 'বিবাদী', 'Legacy Court', 'ACTIVE', ?, ?)`).run('2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z');
  apply(db, offlineCaseToolsMigration);
  assert.equal(db.prepare("SELECT case_title FROM cases WHERE id='preserved'").get().case_title, 'Preserved মামলা');
  assert.equal(db.prepare("SELECT court_id FROM cases WHERE id='preserved'").get().court_id, null);
}

// Failed migration rolls back every v5 structure.
{
  const db = createThrough(4);
  assert.throws(() => apply(db, offlineCaseToolsMigration, 'CREATE TABLE cases (id TEXT)'));
  assert.equal(db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE name='courts'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM pragma_table_info('cases') WHERE name='court_id'").get().count, 0);
}

// Courts preserve Unicode, reject normalized duplicates, and cannot be deleted while referenced.
{
  const db = createThrough(5);
  const stamp = '2026-09-04T00:00:00.000Z';
  db.prepare('INSERT INTO courts VALUES (?, ?, ?, ?, ?, ?, ?)').run('court-1', 'সদর সিভিল জজ আদালত', 'সদর', 'সদর সিভিল জজ আদালত', 'সদর', stamp, stamp);
  assert.throws(() => db.prepare('INSERT INTO courts VALUES (?, ?, ?, ?, ?, ?, ?)').run('court-2', 'সদর সিভিল জজ আদালত', 'অন্য', 'সদর সিভিল জজ আদালত', 'অন্য', stamp, stamp));
  insertCase(db, 'linked', 'PETITIONER', 'court-1', 'সদর সিভিল জজ আদালত');
  assert.throws(() => db.prepare("DELETE FROM courts WHERE id='court-1'").run());
  assert.equal(db.prepare("SELECT represented_role FROM cases WHERE id='linked'").get().represented_role, 'PETITIONER');
  assert.equal(db.prepare("SELECT full_name FROM courts WHERE id='court-1'").get().full_name, 'সদর সিভিল জজ আদালত');
}

// Hearing payments retain exact minor units; older records remain Not recorded.
{
  const db = createThrough(5); insertCase(db, 'payment-case');
  db.prepare(`INSERT INTO case_history (id, case_id, hearing_date, payment_status, payment_amount_minor, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('paid', 'payment-case', '2026-09-01', 'PAID', 150075, '2026-09-01T00:00:00.000Z');
  db.prepare(`INSERT INTO case_history (id, case_id, hearing_date, payment_status, created_at) VALUES (?, ?, ?, ?, ?)`).run('unpaid', 'payment-case', '2026-09-02', 'UNPAID', '2026-09-02T00:00:00.000Z');
  db.prepare(`INSERT INTO case_history (id, case_id, hearing_date, created_at) VALUES (?, ?, ?, ?)`).run('old', 'payment-case', '2026-08-01', '2026-08-01T00:00:00.000Z');
  assert.equal(db.prepare("SELECT payment_amount_minor FROM case_history WHERE id='paid'").get().payment_amount_minor, 150075);
  assert.equal(db.prepare("SELECT payment_status FROM case_history WHERE id='old'").get().payment_status, null);
  assert.throws(() => db.prepare("INSERT INTO case_history (id, case_id, hearing_date, payment_status, payment_amount_minor, created_at) VALUES ('bad','payment-case','2026-09-03','PAID',-1,'2026-09-03T00:00:00.000Z')").run());
}
assert.equal(parsePaymentAmountMinor('1500.75'), 150075);
assert.equal(formatPaymentAmountMinor(150075), '1500.75');
assert.throws(() => parsePaymentAmountMinor('-1'), /non-negative/i);

// Tasks sort pending first, preserve due dates, reopen safely, and cascade only with their case.
{
  const db = createThrough(5); insertCase(db, 'task-case'); insertCase(db, 'other-case');
  const stamp = '2026-09-04T00:00:00.000Z';
  db.prepare('INSERT INTO case_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('later', 'task-case', 'Later', null, '2026-09-20', 0, stamp, null, stamp);
  db.prepare('INSERT INTO case_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('soon', 'task-case', 'Soon', 'Call client', '2026-09-10', 0, stamp, null, stamp);
  db.prepare('INSERT INTO case_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('done', 'task-case', 'Done', null, null, 1, stamp, stamp, stamp);
  assert.deepEqual(db.prepare(`SELECT id FROM case_tasks WHERE case_id='task-case' ORDER BY is_completed, CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date, created_at`).all().map((row) => row.id), ['soon', 'later', 'done']);
  db.prepare("UPDATE case_tasks SET is_completed=0, completed_at=NULL WHERE id='done'").run();
  assert.equal(db.prepare("SELECT completed_at FROM case_tasks WHERE id='done'").get().completed_at, null);
  db.prepare("DELETE FROM cases WHERE id='task-case'").run();
  assert.equal(db.prepare("SELECT COUNT(*) count FROM case_tasks WHERE case_id='task-case'").get().count, 0);
  assert.ok(db.prepare("SELECT id FROM cases WHERE id='other-case'").get());
}

assert.equal(REPRESENTED_SIDE_OPTIONS.length, 13);
for (const value of ['PLAINTIFF', 'DEFENDANT', 'PETITIONER', 'APPELLANT', 'RESPONDENT', 'REVISIONER', 'OPPONENT', 'DECREE_HOLDER', 'JUDGMENT_DEBTOR', 'FIRST_PARTY', 'SECOND_PARTY', 'STATE', 'ACCUSED']) assert.ok(REPRESENTED_SIDE_OPTIONS.some((option) => option.value === value));

const navigator = readFileSync(new URL('../src/navigation/AppNavigator.tsx', import.meta.url), 'utf8');
const releaseFeatures = readFileSync(new URL('../src/config/releaseFeatures.ts', import.meta.url), 'utf8');
const placeholder = readFileSync(new URL('../src/screens/AiComingSoonScreen.tsx', import.meta.url), 'utf8');
assert.match(releaseFeatures, /ONLINE_AI_ENABLED = false/);
assert.match(navigator, /AiComingSoonScreen/);
assert.doesNotMatch(placeholder, /fetch\(|health|session|Gemini|EXPO_PUBLIC_AI_BACKEND_URL/);

console.log('Offline v5 migration, courts, roles, payments, tasks, cascades, and AI-disabled release contracts passed.');
