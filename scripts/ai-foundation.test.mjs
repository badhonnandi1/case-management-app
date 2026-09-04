import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { INITIAL_SCHEMA_STATEMENTS } from '../src/database/schema.ts';
import { caseRemindersMigration } from '../src/database/migrations/002_case_reminders.ts';
import { caseNumberAndSideMigration } from '../src/database/migrations/003_case_number_and_side.ts';
import { aiAssistantMigration } from '../src/database/migrations/004_ai_assistant.ts';
import { classifyAiSource } from '../src/utils/aiIndexState.ts';
import { chunkPages, estimateTokenCount, normalizePageText } from '../src/utils/chunkText.ts';
import { classifySelectableText } from '../src/utils/pdfText.ts';
import { sha256Hex } from '../src/utils/sha256.ts';
import { buildSafeFtsQuery } from '../src/utils/ftsQuery.ts';

const migrations = [
  { version: 1, name: 'initial_schema', statements: INITIAL_SCHEMA_STATEMENTS },
  caseRemindersMigration,
  caseNumberAndSideMigration,
  aiAssistantMigration,
];

function createDatabaseThrough(version) {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(`CREATE TABLE _migrations (
    version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at TEXT NOT NULL
  )`);
  for (const migration of migrations.filter((item) => item.version <= version)) {
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const statement of migration.statements) database.exec(statement);
      database.prepare('INSERT INTO _migrations VALUES (?, ?, ?)').run(
        migration.version, migration.name, '2026-09-03T00:00:00.000Z',
      );
      database.exec(`PRAGMA user_version = ${migration.version}`);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
  return database;
}

function insertCase(database, id) {
  database.prepare(`INSERT INTO cases (
    id, case_number, case_title, party_name, opposite_party_name, court_name,
    status, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`)
    .run(id, `${id}/2026`, `${id} title`, 'Party', 'Opponent', 'Court',
      '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z');
}

function insertDocument(database, id, caseId) {
  database.prepare(`INSERT INTO documents (
    id, case_id, file_name, file_path, file_type, created_at
  ) VALUES (?, ?, ?, ?, 'PDF', ?)`)
    .run(id, caseId, `${id}.pdf`, `file:///local/${id}.pdf`, '2026-09-03T00:00:00.000Z');
}

function insertSource(database, id, caseId, documentId, status = 'ready') {
  database.prepare(`INSERT INTO ai_sources (
    id, case_id, document_id, file_hash, file_size, extraction_status,
    page_count, extracted_at, parser_version, error_message, created_at, updated_at
  ) VALUES (?, ?, ?, 'hash', 100, ?, 1, ?, 'parser-v1', NULL, ?, ?)`)
    .run(id, caseId, documentId, status,
      status === 'ready' ? '2026-09-03T00:00:00.000Z' : null,
      '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z');
}

function insertChunk(database, id, sourceId, caseId, documentId, content, index = 0) {
  database.prepare(`INSERT INTO ai_chunks (
    id, source_id, case_id, document_id, chunk_index, page_start, page_end, content, created_at
  ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`)
    .run(id, sourceId, caseId, documentId, index, content, '2026-09-03T00:00:00.000Z');
}

// Fresh install reaches v4 and creates every AI structure.
{
  const database = createDatabaseThrough(4);
  assert.equal(database.prepare('PRAGMA user_version').get().user_version, 4);
  const names = new Set(database.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'ai_%'").all().map((row) => row.name));
  for (const name of ['ai_sources', 'ai_chunks', 'ai_chunks_fts', 'ai_threads', 'ai_thread_cases', 'ai_thread_documents', 'ai_messages', 'ai_citations']) {
    assert.ok(names.has(name), `missing ${name}`);
  }
  assert.equal(database.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled").get().enabled, 1);
}

// Upgrade v3 -> v4 preserves existing rows.
{
  const database = createDatabaseThrough(3);
  insertCase(database, 'preserved-case');
  database.exec('BEGIN IMMEDIATE');
  for (const statement of aiAssistantMigration.statements) database.exec(statement);
  database.prepare('INSERT INTO _migrations VALUES (?, ?, ?)').run(4, aiAssistantMigration.name, '2026-09-03T00:00:00.000Z');
  database.exec('PRAGMA user_version = 4');
  database.exec('COMMIT');
  assert.equal(database.prepare("SELECT case_title FROM cases WHERE id = 'preserved-case'").get().case_title, 'preserved-case title');
}

// Failed DDL is fully rolled back.
{
  const database = createDatabaseThrough(3);
  assert.throws(() => {
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const statement of aiAssistantMigration.statements) database.exec(statement);
      database.exec('CREATE TABLE cases (id TEXT)');
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'ai_sources'").get().count, 0);
}

// FTS insert, update and delete triggers preserve Bangla/English Unicode.
{
  const database = createDatabaseThrough(4);
  insertCase(database, 'case-a');
  insertDocument(database, 'doc-a', 'case-a');
  insertSource(database, 'source-a', 'case-a', 'doc-a');
  insertChunk(database, 'chunk-a', 'source-a', 'case-a', 'doc-a', 'বাংলা hearing আদালত evidence');
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM ai_chunks_fts WHERE ai_chunks_fts MATCH 'বাংলা'").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM ai_chunks_fts WHERE ai_chunks_fts MATCH 'hearing'").get().count, 1);
  database.prepare('UPDATE ai_chunks SET content = ? WHERE id = ?').run('মিশ্র mixed updated text', 'chunk-a');
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM ai_chunks_fts WHERE ai_chunks_fts MATCH 'hearing'").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM ai_chunks_fts WHERE ai_chunks_fts MATCH 'updated'").get().count, 1);
  database.prepare('DELETE FROM ai_chunks WHERE id = ?').run('chunk-a');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM ai_chunks_fts').get().count, 0);
}

// Duplicated traceability columns cannot be assigned to a different case/document.
{
  const database = createDatabaseThrough(4);
  insertCase(database, 'trace-a');
  insertCase(database, 'trace-b');
  insertDocument(database, 'trace-doc', 'trace-a');
  assert.throws(() => insertSource(database, 'bad-source', 'trace-b', 'trace-doc'));
}

// Case and document cascades remove indexes, FTS rows, and selection relationships.
{
  const database = createDatabaseThrough(4);
  insertCase(database, 'case-delete');
  insertDocument(database, 'doc-delete', 'case-delete');
  insertSource(database, 'source-delete', 'case-delete', 'doc-delete');
  insertChunk(database, 'chunk-delete', 'source-delete', 'case-delete', 'doc-delete', 'searchable deletion contract');
  database.prepare('INSERT INTO ai_threads VALUES (?, ?, ?, ?)').run('thread-delete', 'Chat', '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z');
  database.prepare('INSERT INTO ai_thread_cases VALUES (?, ?)').run('thread-delete', 'case-delete');
  database.prepare('INSERT INTO ai_thread_documents VALUES (?, ?)').run('thread-delete', 'doc-delete');
  database.prepare('DELETE FROM documents WHERE id = ?').run('doc-delete');
  assert.equal(database.prepare('SELECT COUNT(*) count FROM ai_sources').get().count, 0);
  assert.equal(database.prepare('SELECT COUNT(*) count FROM ai_chunks_fts').get().count, 0);
  assert.equal(database.prepare('SELECT COUNT(*) count FROM ai_thread_documents').get().count, 0);
  insertDocument(database, 'doc-case-cascade', 'case-delete');
  insertSource(database, 'source-case-cascade', 'case-delete', 'doc-case-cascade');
  insertChunk(database, 'chunk-case-cascade', 'source-case-cascade', 'case-delete', 'doc-case-cascade', 'case cascade searchable');
  database.prepare('DELETE FROM cases WHERE id = ?').run('case-delete');
  assert.equal(database.prepare('SELECT COUNT(*) count FROM ai_sources').get().count, 0);
  assert.equal(database.prepare('SELECT COUNT(*) count FROM ai_thread_cases').get().count, 0);
  assert.equal(database.prepare('SELECT COUNT(*) count FROM ai_chunks_fts').get().count, 0);
}

// Deleting chat state leaves reusable indexes intact.
{
  const database = createDatabaseThrough(4);
  insertCase(database, 'case-chat');
  insertDocument(database, 'doc-chat', 'case-chat');
  insertSource(database, 'source-chat', 'case-chat', 'doc-chat');
  insertChunk(database, 'chunk-chat', 'source-chat', 'case-chat', 'doc-chat', 'reusable indexed document content');
  database.prepare('INSERT INTO ai_threads VALUES (?, ?, ?, ?)').run('thread-chat', 'Chat', '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z');
  database.prepare('DELETE FROM ai_threads WHERE id = ?').run('thread-chat');
  assert.equal(database.prepare('SELECT COUNT(*) count FROM ai_sources').get().count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) count FROM ai_chunks_fts').get().count, 1);
}

// Interrupted indexing recovery removes searchable remnants and records failure.
{
  const database = createDatabaseThrough(4);
  insertCase(database, 'case-interrupt');
  insertDocument(database, 'doc-interrupt', 'case-interrupt');
  insertSource(database, 'source-interrupt', 'case-interrupt', 'doc-interrupt', 'indexing');
  insertChunk(database, 'chunk-interrupt', 'source-interrupt', 'case-interrupt', 'doc-interrupt', 'partial content must disappear');
  database.exec("DELETE FROM ai_chunks WHERE source_id IN (SELECT id FROM ai_sources WHERE extraction_status = 'indexing')");
  database.prepare("UPDATE ai_sources SET extraction_status = 'failed', error_message = ? WHERE extraction_status = 'indexing'").run('Indexing was interrupted before completion.');
  assert.equal(database.prepare('SELECT COUNT(*) count FROM ai_chunks_fts').get().count, 0);
  assert.equal(database.prepare("SELECT extraction_status FROM ai_sources WHERE id = 'source-interrupt'").get().extraction_status, 'failed');
}

// A failed chunk replacement rolls back completely; indexing rows are never eligible for retrieval.
{
  const database = createDatabaseThrough(4);
  insertCase(database, 'case-atomic');
  insertDocument(database, 'doc-atomic', 'case-atomic');
  insertSource(database, 'source-atomic', 'case-atomic', 'doc-atomic', 'indexing');
  insertChunk(database, 'chunk-old', 'source-atomic', 'case-atomic', 'doc-atomic', 'old complete content');
  assert.throws(() => {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('DELETE FROM ai_chunks WHERE source_id = ?').run('source-atomic');
      insertChunk(database, 'chunk-new', 'source-atomic', 'case-atomic', 'doc-atomic', 'new partial content');
      database.exec('UPDATE ai_sources SET missing_column = 1');
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  });
  assert.equal(database.prepare("SELECT id FROM ai_chunks WHERE source_id = 'source-atomic'").get().id, 'chunk-old');
  assert.equal(database.prepare(`SELECT COUNT(*) count FROM ai_chunks_fts
    JOIN ai_chunks chunks ON chunks.id = ai_chunks_fts.chunk_id
    JOIN ai_sources sources ON sources.id = chunks.source_id
    WHERE sources.extraction_status = 'ready'`).get().count, 0);
}

// A bound, explicit scope never returns the unselected document.
{
  const database = createDatabaseThrough(4);
  insertCase(database, 'scope-a');
  insertCase(database, 'scope-b');
  insertDocument(database, 'scope-doc-a', 'scope-a');
  insertDocument(database, 'scope-doc-b', 'scope-b');
  insertSource(database, 'scope-source-a', 'scope-a', 'scope-doc-a');
  insertSource(database, 'scope-source-b', 'scope-b', 'scope-doc-b');
  insertChunk(database, 'scope-chunk-a', 'scope-source-a', 'scope-a', 'scope-doc-a', 'evidence hearing selected result');
  insertChunk(database, 'scope-chunk-b', 'scope-source-b', 'scope-b', 'scope-doc-b', 'evidence hearing secret result');
  const rows = database.prepare(`SELECT chunks.document_id FROM ai_chunks_fts
    JOIN ai_chunks chunks ON chunks.id = ai_chunks_fts.chunk_id
    JOIN ai_sources sources ON sources.id = chunks.source_id
    WHERE ai_chunks_fts MATCH ? AND sources.extraction_status = 'ready'
      AND chunks.document_id IN (?)`).all('evidence', 'scope-doc-a');
  assert.deepEqual(rows.map((row) => row.document_id), ['scope-doc-a']);
}

// Unicode-safe normalization, deterministic token estimation, page ranges and overlap.
assert.equal(normalizePageText('  মামলা\t৪২/২০২৬ \r\n\r\n Hearing: 15-09-2026  '), 'মামলা ৪২/২০২৬\n\nHearing: 15-09-2026');
assert.ok(estimateTokenCount('মামলা ৪২/২০২৬ and hearing') > 0);
const longParagraphs = Array.from({ length: 24 }, (_, index) =>
  `Heading ${index}\nLegal paragraph ${index} মামলা নম্বর ৪২/২০২৬ hearing evidence order date amount 10,000. `
  + 'Additional factual text preserves names and punctuation. '.repeat(6),
).join('\n\n');
const chunks = chunkPages([
  { pageNumber: 1, text: longParagraphs },
  { pageNumber: 2, text: longParagraphs.replaceAll('42', '43') },
]);
assert.ok(chunks.length >= 2);
assert.ok(chunks.every((chunk) => chunk.pageStart >= 1 && chunk.pageEnd <= 2));
assert.ok(chunks.every((chunk) => estimateTokenCount(chunk.content) <= 800));
assert.ok(chunks.slice(1).some((chunk, index) => {
  const previousTail = chunks[index].content.split(/\s+/).slice(-8).join(' ');
  return chunk.content.includes(previousTail);
}), 'adjacent chunks should carry deterministic trailing overlap');
const crossPageChunks = chunkPages([
  { pageNumber: 3, text: 'Page three legal evidence and hearing detail. '.repeat(22) },
  { pageNumber: 4, text: 'Page four আদালত মামলা order and date detail. '.repeat(20) },
]);
assert.ok(crossPageChunks.some((chunk) => chunk.pageStart === 3 && chunk.pageEnd === 4));
const otherDocumentChunks = chunkPages([{ pageNumber: 7, text: 'Separate document text. '.repeat(500) }]);
assert.ok(otherDocumentChunks.every((chunk) => chunk.pageStart === 7 && chunk.pageEnd === 7));

// Stable hashing and changed/unchanged/parser-version index state detection.
const abc = new TextEncoder().encode('abc');
assert.equal(sha256Hex(abc), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
assert.equal(sha256Hex(abc), sha256Hex(new TextEncoder().encode('abc')));
assert.notEqual(sha256Hex(abc), sha256Hex(new TextEncoder().encode('abd')));
assert.equal(buildSafeFtsQuery('বাংলা " OR secret:* -- hearing'), '"বাংলা"* OR "or"* OR "secret"* OR "hearing"*');
const readySource = {
  id: 's', caseId: 'c', documentId: 'd', fileHash: 'same', fileSize: 3,
  extractionStatus: 'ready', pageCount: 1, extractedAt: '2026-09-03T00:00:00.000Z',
  parserVersion: 'v1', errorMessage: null, createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z',
};
assert.equal(classifyAiSource(readySource, 'same', 'v1'), 'ready');
assert.equal(classifyAiSource(readySource, 'changed', 'v1'), 'outdated');
assert.equal(classifyAiSource(readySource, 'same', 'v2'), 'outdated');
assert.equal(classifyAiSource({ ...readySource, extractionStatus: 'indexing' }, 'same', 'v1'), 'interrupted');

// Empty/scanned-like pages and real text are distinguished without OCR/upload.
assert.equal(classifySelectableText([], 0), 'empty');
assert.equal(classifySelectableText([{ pageNumber: 1, text: '' }], 1), 'requires_ocr');
assert.equal(classifySelectableText([{ pageNumber: 1, text: 'Substantial selectable English and বাংলা legal document text ৪২/২০২৬.' }], 1), 'success');

// Portable backup enumeration is explicit and excludes all AI-derived/chat tables.
const backupService = readFileSync(new URL('../src/services/backupService.ts', import.meta.url), 'utf8');
assert.match(backupService, /const data: BackupData = \{\s*cases:/);
assert.doesNotMatch(backupService, /getAllAi|aiChunks|aiMessages|apiKey|backendToken/i);
const restoreRepository = readFileSync(new URL('../src/repositories/backupRepository.ts', import.meta.url), 'utf8');
assert.match(restoreRepository, /DELETE FROM ai_threads/);
assert.match(restoreRepository, /DELETE FROM ai_sources/);

console.log('AI migration, FTS, cascades, Unicode chunking, hashing, recovery, scope, and backup contracts passed.');
