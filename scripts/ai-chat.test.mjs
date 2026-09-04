import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { AI_API_LIMITS, AI_CONSENT_VERSION, AI_FREE_TIER_PRIVACY_NOTICE } from '../shared/aiAnswerContract.ts';
import { INITIAL_SCHEMA_STATEMENTS } from '../src/database/schema.ts';
import { caseRemindersMigration } from '../src/database/migrations/002_case_reminders.ts';
import { caseNumberAndSideMigration } from '../src/database/migrations/003_case_number_and_side.ts';
import { aiAssistantMigration } from '../src/database/migrations/004_ai_assistant.ts';
import {
  aiAssistantReducer,
  initialAiAssistantState,
} from '../src/utils/aiUi.ts';
import {
  aiRequestPhaseLabel,
  inferAiQuestionLanguage,
  isCurrentAiRequestSequence,
  safeAiRequestError,
  validateAiQuestion,
} from '../src/utils/aiConversation.ts';

const now = '2026-09-04T00:00:00.000Z';
const later = '2026-09-04T00:01:00.000Z';
const screenSource = readFileSync('src/screens/AiAssistantScreen.tsx', 'utf8');
const conversationServiceSource = readFileSync('src/services/aiConversationService.ts', 'utf8');
const chatRepositorySource = readFileSync('src/repositories/aiChatRepository.ts', 'utf8');
const consentSource = readFileSync('src/components/ai/AiOnlineConsent.tsx', 'utf8');
const consentServiceSource = readFileSync('src/services/aiOnlineConsentService.ts', 'utf8');
const composerSource = readFileSync('src/components/ai/AiQuestionComposer.tsx', 'utf8');
const conversationListSource = readFileSync('src/components/ai/AiConversationList.tsx', 'utf8');
const backupSource = readFileSync('src/services/backupService.ts', 'utf8');

// Composer validation preserves Bangla, English, mixed text, punctuation, dates, and amounts.
assert.deepEqual(validateAiQuestion('   '), { valid: false, message: 'Enter a question before sending.' });
assert.equal(validateAiQuestion('  আদেশ কী?  ').question, 'আদেশ কী?');
assert.equal(validateAiQuestion('  What happened on 12/09/2026 for ৳5,000?  ').question, 'What happened on 12/09/2026 for ৳5,000?');
assert.equal(validateAiQuestion('  পরবর্তী hearing date কী?  ').question, 'পরবর্তী hearing date কী?');
assert.equal(validateAiQuestion('x'.repeat(AI_API_LIMITS.questionCharacters + 1)).valid, false);
assert.equal(inferAiQuestionLanguage('আদেশ কী?'), 'bn');
assert.equal(inferAiQuestionLanguage('What is the order?'), 'en');
assert.equal(inferAiQuestionLanguage('পরবর্তী hearing date কী?'), 'mixed');
assert.match(composerSource, /multiline/);
assert.doesNotMatch(composerSource, /maxLength=/);

// The reducer prevents impossible or out-of-order request states.
let state = aiAssistantReducer(initialAiAssistantState, { type: 'START_CHAT_REQUEST' });
assert.equal(state.phase, 'home');
state = aiAssistantReducer(initialAiAssistantState, {
  type: 'OPEN_THREAD', threadId: 'thread-1', title: 'Prepared', caseIds: ['case-1'], documentIds: ['doc-1'], ready: true,
});
assert.equal(state.phase, 'chat_loading');
state = aiAssistantReducer(state, { type: 'CHAT_RESTORED', readySourceCount: 1 });
assert.equal(state.phase, 'chat_ready');
state = aiAssistantReducer(state, { type: 'START_CHAT_REQUEST' });
assert.equal(state.phase, 'chat_retrieving');
assert.equal(aiAssistantReducer(state, { type: 'START_CHAT_REQUEST' }).phase, 'chat_retrieving');
assert.equal(aiAssistantReducer(state, { type: 'REQUEST_SENT' }).phase, 'chat_retrieving');
state = aiAssistantReducer(state, { type: 'LOCAL_EVIDENCE_FOUND' });
assert.equal(state.phase, 'chat_preparing');
state = aiAssistantReducer(state, { type: 'EVIDENCE_READY', needsConsent: true });
assert.equal(state.phase, 'chat_awaiting_consent');
assert.equal(aiAssistantReducer(state, { type: 'REQUEST_SENT' }).phase, 'chat_awaiting_consent');
state = aiAssistantReducer(state, { type: 'CONSENT_GRANTED' });
assert.equal(state.phase, 'chat_connecting');
state = aiAssistantReducer(state, { type: 'REQUEST_SENT' });
assert.equal(state.phase, 'chat_generating');
state = aiAssistantReducer(state, { type: 'RESPONSE_RECEIVED' });
assert.equal(state.phase, 'chat_validating');
state = aiAssistantReducer(state, { type: 'VALIDATION_PASSED' });
assert.equal(state.phase, 'chat_saving');
state = aiAssistantReducer(state, { type: 'EXCHANGE_SAVED' });
assert.equal(state.phase, 'chat_completed');

let cancelled = aiAssistantReducer(state, { type: 'START_CHAT_REQUEST' });
cancelled = aiAssistantReducer(cancelled, { type: 'REQUEST_CANCELLED' });
assert.equal(cancelled.phase, 'chat_cancelled');
assert.equal(aiAssistantReducer(cancelled, { type: 'EXCHANGE_SAVED' }).phase, 'chat_cancelled');
assert.equal(isCurrentAiRequestSequence(7, 7, false), true);
assert.equal(isCurrentAiRequestSequence(7, 8, false), false);
assert.equal(isCurrentAiRequestSequence(7, 7, true), false);
for (const phase of ['chat_retrieving', 'chat_preparing', 'chat_awaiting_consent', 'chat_connecting', 'chat_generating', 'chat_validating', 'chat_saving']) {
  assert.ok(aiRequestPhaseLabel(phase), `missing progress label for ${phase}`);
}
assert.match(safeAiRequestError('RATE_LIMITED', 30), /30 seconds/);

// Local scope/retrieval must complete before backend availability or transmission.
assert.ok(screenSource.indexOf('prepareAiConversationEvidence') < screenSource.indexOf('refreshBackendAvailability(controller.signal)'));
assert.ok(screenSource.indexOf('hasCurrentAiOnlineConsent') < screenSource.indexOf('transmitPendingChatRequest(pending)'));
assert.match(screenSource, /onRetryBackend=\{\(\) => void wakeBackendManually\(\)\}/);
assert.match(screenSource, /backendWakeController\.current\?\.abort\(\)/);
assert.match(readFileSync('src/components/ai/AiChatView.tsx', 'utf8'), /disabled=\{props\.backendChecking \|\| !props\.backendAvailable\}/);
assert.match(conversationServiceSource, /caseScope\.has\(result\.caseId\)/);
assert.match(conversationServiceSource, /documentScope\.has\(result\.documentId\)/);
assert.match(conversationServiceSource, /slice\(0, AI_API_LIMITS\.evidenceItems\)/);
assert.match(conversationServiceSource, /validateAiCitationTarget/);
assert.doesNotMatch(conversationServiceSource, /\bfetch\s*\(|sendOnlineAiAnswer|filePath/);
assert.match(screenSource, /No online request was made/);
assert.match(screenSource, /requestSequence\.current/);
assert.match(screenSource, /requestController\.current/);
assert.match(screenSource, /persistenceStarted\.current/);

// Consent is conservative, context-versioned, unchecked, reviewable, and resettable.
assert.match(AI_CONSENT_VERSION, /gemini-free-selected-excerpts/);
assert.match(AI_FREE_TIER_PRIVACY_NOTICE, /submitted content may be used to improve Google/);
assert.match(consentSource, /Original PDFs and images are not uploaded/);
assert.match(consentSource, /authorized/);
assert.match(consentSource, /useState\(false\)/);
assert.doesNotMatch(consentSource, /useState\(true\)/);
assert.match(consentServiceSource, /ai_online_consent_context/);
assert.match(consentServiceSource, /resetAiOnlineConsent/);
assert.doesNotMatch(consentServiceSource, /EXPO_PUBLIC.*tier|paid/i);
assert.doesNotMatch(backupSource, /ai_online_consent_context/);

// Responses are plain selectable text; no HTML/WebView execution path exists.
assert.match(conversationListSource, /<Text selectable/);
assert.doesNotMatch(conversationListSource, /WebView|renderHTML|dangerouslySetInnerHTML/);
assert.match(conversationListSource, /citation\.citationNumber/);
assert.match(screenSource, /validateAiCitationTarget\(citation\)/);
assert.match(screenSource, /installed PDF viewer does not support a reliable page jump/);

// Repository uses one exclusive transaction for the paired exchange and validates citations before commit.
assert.match(chatRepositorySource, /saveAiExchangeWithCitations/);
assert.match(chatRepositorySource, /withExclusiveTransactionAsync/);
assert.match(chatRepositorySource, /insertValidatedCitations/);
assert.match(chatRepositorySource, /UPDATE ai_threads SET updated_at/);
assert.match(chatRepositorySource, /ORDER BY created_at ASC, rowid ASC/);
assert.doesNotMatch(chatRepositorySource, /sessionToken|filePath|GEMINI_API_KEY/);

{
  const database = createDatabase();
  insertFixture(database);
  database.exec('BEGIN IMMEDIATE');
  try {
    insertMessage(database, 'user-1', 'user', 'বাংলা and English question', now);
    insertMessage(database, 'assistant-1', 'assistant', '<script>plain untrusted answer</script>', now);
    database.prepare(`INSERT INTO ai_citations (
      id, message_id, chunk_id, document_id, page_start, page_end, citation_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run('citation-1', 'assistant-1', 'chunk-1', 'doc-1', 4, 5, 1);
    database.prepare('UPDATE ai_threads SET updated_at = ? WHERE id = ?').run(later, 'thread-1');
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  assert.deepEqual(
    database.prepare("SELECT role FROM ai_messages ORDER BY created_at ASC, rowid ASC").all().map((row) => row.role),
    ['user', 'assistant'],
  );
  assert.equal(database.prepare('SELECT COUNT(*) count FROM ai_citations').get().count, 1);
  assert.equal(database.prepare("SELECT updated_at FROM ai_threads WHERE id = 'thread-1'").get().updated_at, later);

  database.prepare('DELETE FROM ai_messages WHERE thread_id = ?').run('thread-1');
  assert.equal(database.prepare('SELECT COUNT(*) count FROM ai_messages').get().count, 0);
  assert.equal(database.prepare('SELECT COUNT(*) count FROM ai_citations').get().count, 0);
  assert.equal(database.prepare('SELECT COUNT(*) count FROM ai_sources').get().count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) count FROM documents').get().count, 1);

  database.exec('BEGIN IMMEDIATE');
  try {
    insertMessage(database, 'user-rollback', 'user', 'Question that must roll back', later);
    insertMessage(database, 'assistant-rollback', 'assistant', 'Answer that must roll back', later);
    database.prepare(`INSERT INTO ai_citations (
      id, message_id, chunk_id, document_id, page_start, page_end, citation_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run('citation-bad', 'assistant-rollback', 'unknown-chunk', 'doc-1', 1, 1, 1);
    database.exec('COMMIT');
    assert.fail('invalid citation should fail');
  } catch {
    database.exec('ROLLBACK');
  }
  assert.equal(database.prepare('SELECT COUNT(*) count FROM ai_messages').get().count, 0);

  database.prepare('DELETE FROM ai_threads WHERE id = ?').run('thread-1');
  assert.equal(database.prepare('SELECT COUNT(*) count FROM ai_sources').get().count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) count FROM ai_chunks_fts').get().count, 1);
}

console.log('AI conversational state, composer, scoped pipeline, consent, rendering, atomic persistence, cancellation, and privacy contracts passed.');

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  for (const statement of INITIAL_SCHEMA_STATEMENTS) database.exec(statement);
  for (const migration of [caseRemindersMigration, caseNumberAndSideMigration, aiAssistantMigration]) {
    for (const statement of migration.statements) database.exec(statement);
  }
  return database;
}

function insertFixture(database) {
  database.prepare(`INSERT INTO cases (
    id, case_number, case_title, party_name, opposite_party_name, court_name,
    status, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`).run('case-1', '1/2026', 'Synthetic case', 'A', 'B', 'Court', now, now);
  database.prepare(`INSERT INTO documents (
    id, case_id, file_name, file_path, file_type, created_at
  ) VALUES (?, ?, ?, ?, 'PDF', ?)`).run('doc-1', 'case-1', 'synthetic.pdf', 'file:///synthetic.pdf', now);
  database.prepare(`INSERT INTO ai_sources (
    id, case_id, document_id, file_hash, file_size, extraction_status,
    page_count, extracted_at, parser_version, created_at, updated_at
  ) VALUES (?, ?, ?, 'hash', 10, 'ready', 5, ?, 'parser', ?, ?)`).run('source-1', 'case-1', 'doc-1', now, now, now);
  database.prepare(`INSERT INTO ai_chunks (
    id, source_id, case_id, document_id, chunk_index, page_start, page_end, content, created_at
  ) VALUES (?, ?, ?, ?, 0, 4, 5, ?, ?)`).run('chunk-1', 'source-1', 'case-1', 'doc-1', 'Synthetic searchable evidence with enough content.', now);
  database.prepare('INSERT INTO ai_threads VALUES (?, ?, ?, ?)').run('thread-1', 'Prepared', now, now);
  database.prepare('INSERT INTO ai_thread_cases VALUES (?, ?)').run('thread-1', 'case-1');
  database.prepare('INSERT INTO ai_thread_documents VALUES (?, ?)').run('thread-1', 'doc-1');
}

function insertMessage(database, id, role, content, createdAt) {
  database.prepare(`INSERT INTO ai_messages (
    id, thread_id, role, content, model_name, input_tokens, output_tokens, estimated_cost, created_at
  ) VALUES (?, 'thread-1', ?, ?, ?, ?, ?, NULL, ?)`).run(
    id,
    role,
    content,
    role === 'assistant' ? 'synthetic-model' : null,
    role === 'assistant' ? 10 : null,
    role === 'assistant' ? 5 : null,
    createdAt,
  );
}
