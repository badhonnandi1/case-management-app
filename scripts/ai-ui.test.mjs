import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { INITIAL_SCHEMA_STATEMENTS } from '../src/database/schema.ts';
import { caseRemindersMigration } from '../src/database/migrations/002_case_reminders.ts';
import { caseNumberAndSideMigration } from '../src/database/migrations/003_case_number_and_side.ts';
import { aiAssistantMigration } from '../src/database/migrations/004_ai_assistant.ts';
import {
  aiAssistantReducer,
  aiDocumentStatusLabel,
  createDefaultThreadTitle,
  createSearchExcerpt,
  formatCitationPages,
  groupAiDocumentsByCase,
  initialAiAssistantState,
  retryableDocumentIds,
  selectEligibleDocumentIds,
  selectFilteredIds,
  toggleSelectedId,
} from '../src/utils/aiUi.ts';

const now = '2026-09-03T00:00:00.000Z';
const later = '2026-09-03T01:00:00.000Z';

const navigatorSource = readFileSync('src/navigation/AppNavigator.tsx', 'utf8');
const navigationTypes = readFileSync('src/navigation/types.ts', 'utf8');
const appSource = readFileSync('App.tsx', 'utf8');
const databaseSource = readFileSync('src/database/database.ts', 'utf8');
const nativePdfSource = readFileSync('android/app/src/main/java/com/casemanagement/app/LocalPdfTextExtractorModule.kt', 'utf8');
const aiScreenSource = readFileSync('src/screens/AiAssistantScreen.tsx', 'utf8');
const caseSelectorSource = readFileSync('src/components/ai/CaseSelector.tsx', 'utf8');
const chunkRepositorySource = readFileSync('src/repositories/aiChunkRepository.ts', 'utf8');
const retrievalSource = readFileSync('src/services/aiRetrievalService.ts', 'utf8');
const promptTwoSources = [
  aiScreenSource,
  readFileSync('src/components/ai/LocalSearchPreview.tsx', 'utf8'),
  readFileSync('src/services/aiDocumentStatusService.ts', 'utf8'),
  readFileSync('src/services/aiBatchIndexService.ts', 'utf8'),
].join('\n');

// Five tabs are registered in the required order; AI is explicitly lazy.
const tabNames = [...navigatorSource.matchAll(/<Tab\.Screen name="([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(tabNames, ['Home', 'Cases', 'Calendar', 'AI', 'Settings']);
assert.match(navigationTypes, /AI: undefined/);
assert.match(navigatorSource, /AI: \{ active: 'sparkles', inactive: 'sparkles-outline' \}/);
assert.match(navigatorSource, /lazy: true/);
assert.doesNotMatch(appSource, /indexDocument|retrieveLocalContext|checkAiAssistantAvailability/);
assert.doesNotMatch(databaseSource, /recoverInterruptedAiSources|recoverInterruptedIndexes/);
assert.doesNotMatch(nativePdfSource, /\binit\s*\{/);
assert.ok(nativePdfSource.indexOf('fun extract') < nativePdfSource.indexOf('PDFBoxResourceLoader.init'));

// Case selection supports multiple cases and preserves selections while filters change.
let selected = toggleSelectedId([], 'case-a');
selected = toggleSelectedId(selected, 'case-b');
assert.deepEqual(selected, ['case-a', 'case-b']);
assert.deepEqual(selectFilteredIds(selected, ['case-c']), ['case-a', 'case-b', 'case-c']);
assert.deepEqual(selectFilteredIds(['case-a'], ['case-b']), ['case-a', 'case-b']);
assert.match(caseSelectorSource, /searchCases\(search\)/);
assert.match(caseSelectorSource, /Select all filtered/);

const caseA = makeCase('case-a');
const caseB = makeCase('case-b');
const choices = [
  makeChoice(caseA, 'doc-ready', 'ready', true),
  makeChoice(caseA, 'doc-missing', 'missing', false),
  makeChoice(caseB, 'doc-unsupported', 'unsupported', false),
  makeChoice(caseB, 'doc-ocr', 'requires_ocr', true),
];
assert.deepEqual(groupAiDocumentsByCase([caseA, caseB], choices).map((group) => group.choices.length), [2, 2]);
assert.deepEqual(selectEligibleDocumentIds([], choices), ['doc-ready', 'doc-ocr']);
assert.deepEqual(selectEligibleDocumentIds([], choices, 'case-a'), ['doc-ready']);

for (const status of ['checking', 'not_prepared', 'ready', 'changed', 'preparing', 'interrupted', 'requires_ocr', 'missing', 'unsupported', 'failed']) {
  assert.ok(aiDocumentStatusLabel(status).length > 3, `missing label for ${status}`);
}

assert.deepEqual(retryableDocumentIds([
  preparation('ready-doc', 'ready'),
  preparation('failed-doc', 'failed'),
  preparation('cancelled-doc', 'cancelled'),
  preparation('ocr-doc', 'requires_ocr'),
]), ['failed-doc', 'cancelled-doc']);

// Reducer exposes only valid flow phases and restores persisted scope.
let state = aiAssistantReducer(initialAiAssistantState, { type: 'START_SELECTION' });
assert.equal(state.phase, 'case_selection');
state = aiAssistantReducer(state, { type: 'SET_CASES', caseIds: ['case-a', 'case-b'] });
assert.equal(state.phase, 'document_selection');
state = aiAssistantReducer(state, { type: 'SET_DOCUMENTS', documentIds: ['doc-ready'] });
state = aiAssistantReducer(state, { type: 'START_PREPARING' });
assert.equal(state.phase, 'preparing');
state = aiAssistantReducer(state, { type: 'SOURCES_READY', threadId: 'thread-a', title: 'Session A' });
assert.equal(state.phase, 'chat_loading');
state = aiAssistantReducer(state, { type: 'CHAT_RESTORED', readySourceCount: 1 });
assert.equal(state.phase, 'chat_ready');
state = aiAssistantReducer(state, { type: 'OPEN_SEARCH' });
assert.equal(state.phase, 'search');
state = aiAssistantReducer(state, { type: 'CLOSE_SEARCH' });
assert.equal(state.phase, 'chat_ready');
state = aiAssistantReducer(state, { type: 'FAIL', message: 'FTS unavailable', recoverTo: 'chat_ready' });
assert.equal(state.phase, 'error');
assert.equal(aiAssistantReducer(state, { type: 'RECOVER' }).phase, 'chat_ready');
const restored = aiAssistantReducer(initialAiAssistantState, {
  type: 'OPEN_THREAD', threadId: 'thread-a', title: 'Session A',
  caseIds: ['case-a'], documentIds: ['doc-ready'], ready: true,
});
assert.equal(restored.phase, 'chat_loading');
assert.deepEqual(restored.selectedDocumentIds, ['doc-ready']);

assert.equal(createDefaultThreadTitle([caseA], new Date('2026-09-03T00:00:00Z')), caseA.caseNumber);
assert.equal(formatCitationPages(4, 4), 'Page 4');
assert.equal(formatCitationPages(4, 6), 'Pages 4–6');
assert.match(createSearchExcerpt('বাংলা hearing text ' + 'evidence '.repeat(100), 80), /বাংলা hearing/);

// Selected cases and documents are intersected, and empty document scope is rejected.
assert.match(chunkRepositorySource, /scopeClauses\.join\(' AND '\)/);
assert.match(retrievalSource, /caseIds\.length === 0 \|\| documentIds\.length === 0/);
assert.doesNotMatch(promptTwoSources, /\bfetch\s*\(|axios/i);
assert.match(aiScreenSource, /checkFileExists\(document\.filePath\)/);
assert.match(aiScreenSource, /installed PDF viewer does not support a reliable page jump/);

// Session persistence, transactional scope semantics, deletion independence, and index cleanup.
{
  const database = createDatabase();
  insertCase(database, 'case-a');
  insertCase(database, 'case-b');
  insertDocument(database, 'doc-a', 'case-a');
  insertDocument(database, 'doc-b', 'case-b');
  insertSource(database, 'source-a', 'case-a', 'doc-a');
  insertChunk(database, 'chunk-a', 'source-a', 'case-a', 'doc-a');
  database.prepare('INSERT INTO ai_threads VALUES (?, ?, ?, ?)').run('thread-a', 'Prepared', now, now);
  database.prepare('INSERT INTO ai_thread_cases VALUES (?, ?)').run('thread-a', 'case-a');
  database.prepare('INSERT INTO ai_thread_documents VALUES (?, ?)').run('thread-a', 'doc-a');

  database.prepare('UPDATE ai_threads SET title = ?, updated_at = ? WHERE id = ?').run('Renamed', later, 'thread-a');
  assert.equal(database.prepare("SELECT title FROM ai_threads WHERE id = 'thread-a'").get().title, 'Renamed');

  database.exec('BEGIN IMMEDIATE');
  database.prepare('DELETE FROM ai_thread_cases WHERE thread_id = ?').run('thread-a');
  database.prepare('DELETE FROM ai_thread_documents WHERE thread_id = ?').run('thread-a');
  database.prepare('INSERT INTO ai_thread_cases VALUES (?, ?)').run('thread-a', 'case-b');
  database.prepare('INSERT INTO ai_thread_documents VALUES (?, ?)').run('thread-a', 'doc-b');
  database.prepare('UPDATE ai_threads SET updated_at = ? WHERE id = ?').run(later, 'thread-a');
  database.exec('COMMIT');
  assert.deepEqual(database.prepare("SELECT case_id FROM ai_thread_cases WHERE thread_id = 'thread-a'").all().map((row) => row.case_id), ['case-b']);

  database.prepare('DELETE FROM ai_threads WHERE id = ?').run('thread-a');
  assert.equal(database.prepare('SELECT COUNT(*) count FROM ai_sources').get().count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) count FROM documents').get().count, 2);
  database.prepare('DELETE FROM ai_sources WHERE document_id = ?').run('doc-a');
  assert.equal(database.prepare('SELECT COUNT(*) count FROM ai_chunks_fts').get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM documents WHERE id = 'doc-a'").get().count, 1);
}

assert.match(readFileSync('src/repositories/aiChatRepository.ts', 'utf8'), /withExclusiveTransactionAsync/);
assert.match(readFileSync('src/repositories/aiSourceRepository.ts', 'utf8'), /DELETE FROM ai_sources/);

console.log('AI tab navigation, state flow, selection, preparation controls, session scope, local-search privacy, citations, and index cleanup contracts passed.');

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  for (const statement of INITIAL_SCHEMA_STATEMENTS) database.exec(statement);
  for (const migration of [caseRemindersMigration, caseNumberAndSideMigration, aiAssistantMigration]) {
    for (const statement of migration.statements) database.exec(statement);
  }
  return database;
}

function insertCase(database, id) {
  database.prepare(`INSERT INTO cases (
    id, case_number, case_title, party_name, opposite_party_name, court_name,
    status, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`)
    .run(id, `${id}/2026`, `${id} title`, 'Party', 'Opponent', 'Court', now, now);
}

function insertDocument(database, id, caseId) {
  database.prepare(`INSERT INTO documents (
    id, case_id, file_name, file_path, file_type, created_at
  ) VALUES (?, ?, ?, ?, 'PDF', ?)`)
    .run(id, caseId, `${id}.pdf`, `file:///local/${id}.pdf`, now);
}

function insertSource(database, id, caseId, documentId) {
  database.prepare(`INSERT INTO ai_sources (
    id, case_id, document_id, file_hash, file_size, extraction_status,
    page_count, extracted_at, parser_version, created_at, updated_at
  ) VALUES (?, ?, ?, 'hash', 10, 'ready', 1, ?, 'parser', ?, ?)`)
    .run(id, caseId, documentId, now, now, now);
}

function insertChunk(database, id, sourceId, caseId, documentId) {
  database.prepare(`INSERT INTO ai_chunks (
    id, source_id, case_id, document_id, chunk_index, page_start, page_end, content, created_at
  ) VALUES (?, ?, ?, ?, 0, 1, 1, 'local searchable evidence text', ?)`)
    .run(id, sourceId, caseId, documentId, now);
}

function makeCase(id) {
  return {
    id, caseNumber: `${id}/2026`, caseType: null, caseSerial: null, caseYear: null,
    caseTitle: `${id} title`, partyName: 'Party', oppositePartyName: 'Opponent',
    representedSide: null, courtName: 'Court', judgeName: null, previousDate: null,
    nextDate: null, previousOrder: null, nextStep: null, status: 'ACTIVE', notes: null,
    createdAt: now, updatedAt: now,
  };
}

function makeChoice(caseItem, id, status, selectable) {
  return {
    caseItem,
    document: { id, caseId: caseItem.id, fileName: `${id}.pdf`, filePath: `file:///${id}.pdf`, fileType: 'PDF', description: null, createdAt: now },
    source: null,
    status,
    fileExists: status !== 'missing',
    fileSize: 100,
    selectable,
    processable: selectable,
    message: null,
  };
}

function preparation(documentId, status) {
  return { documentId, documentName: `${documentId}.pdf`, status, stage: null, completedPages: 0, pageCount: null, message: null };
}
