import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  AI_API_LIMITS,
  AI_CONSENT_VERSION,
  AI_FREE_TIER_PRIVACY_NOTICE,
  isAiPublicConfigDto,
} from '../shared/aiAnswerContract.ts';
import { INITIAL_SCHEMA_STATEMENTS } from '../src/database/schema.ts';
import { caseRemindersMigration } from '../src/database/migrations/002_case_reminders.ts';
import { caseNumberAndSideMigration } from '../src/database/migrations/003_case_number_and_side.ts';
import { aiAssistantMigration } from '../src/database/migrations/004_ai_assistant.ts';
import { prepareAiAnswerRequest } from '../src/utils/aiAnswerRequest.ts';

const publicConfig = {
  apiVersion: 'v1',
  serverContractVersion: '2026-09-04.1',
  providerDisplayName: 'Google Gemini',
  defaultModelId: 'gemini-3.8-flash',
  allowedModels: [
    { id: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash' },
    { id: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite' },
  ],
  privacy: {
    policyId: 'gemini-free-selected-excerpts-2026-09-04',
    consentVersion: AI_CONSENT_VERSION,
    processingTier: 'free_conservative',
    notice: AI_FREE_TIER_PRIVACY_NOTICE,
    selectedExcerptsOnly: true,
    originalFilesUploaded: false,
  },
  limits: { questionCharacters: AI_API_LIMITS.questionCharacters, evidenceItems: AI_API_LIMITS.evidenceItems },
  features: { onlineAnswers: true, modelSelection: true },
};
assert.equal(isAiPublicConfigDto(publicConfig), true);
assert.equal(isAiPublicConfigDto({ ...publicConfig, allowedModels: [{ id: 'arbitrary', displayName: 'Unsafe' }] }), false);
assert.equal(isAiPublicConfigDto({ ...publicConfig, defaultModelId: 'gemini-not-allowed' }), false);
assert.equal(isAiPublicConfigDto({ ...publicConfig, privacy: { ...publicConfig.privacy, processingTier: 'paid_private' } }), false);

const request = prepareAiAnswerRequest({
  requestId: 'request-production-test',
  threadId: 'thread-production-test',
  question: 'বাংলা and English production configuration test?',
  selectedCaseIds: ['case-1'],
  selectedDocumentIds: ['document-1'],
  retrievalResults: [{
    chunkId: 'chunk-1', caseId: 'case-1', documentId: 'document-1', documentName: 'Synthetic.pdf',
    pageStart: 1, pageEnd: 1, content: 'Synthetic non-confidential evidence.', rank: -1,
  }],
  language: 'mixed',
  modelId: publicConfig.defaultModelId,
  consentVersion: publicConfig.privacy.consentVersion,
  consentGranted: true,
});
assert.equal(request.modelId, publicConfig.defaultModelId);
assert.equal(request.consent.version, publicConfig.privacy.consentVersion);
assert.throws(() => prepareAiAnswerRequest({ ...requestInput(request), modelId: 'unsafe-provider-model' }), /model/i);

const settingsUi = readFileSync('src/components/ai/AiSettingsSection.tsx', 'utf8');
const settingsService = readFileSync('src/services/aiSettingsService.ts', 'utf8');
const configService = readFileSync('src/services/aiPublicConfigService.ts', 'utf8');
assert.doesNotMatch(settingsUi, /TextInput|SecureStore|AsyncStorage/);
assert.doesNotMatch(`${settingsUi}\n${settingsService}\n${configService}`, /GEMINI_API_KEY|SESSION_SIGNING_SECRET/);
assert.match(settingsUi, /Backend-approved models/);
assert.match(settingsUi, /Reset Online Consent/);
assert.match(settingsUi, /Delete All Local AI Chats/);
assert.match(settingsUi, /Delete All Local AI Indexes/);
assert.match(settingsUi, /Administrator Key-Rotation Instructions/);
assert.match(settingsUi, /free tier/i);
assert.match(configService, /\/api\/v1\/config/);
assert.doesNotMatch(configService, /console\./);

const database = createDatabase();
const now = '2026-09-04T00:00:00.000Z';
database.prepare(`INSERT INTO cases (id, case_number, case_title, party_name, opposite_party_name, court_name, status, created_at, updated_at)
  VALUES ('case-1', '1/2026', 'Synthetic', 'A', 'B', 'Court', 'ACTIVE', ?, ?)`).run(now, now);
database.prepare(`INSERT INTO documents (id, case_id, file_name, file_path, file_type, created_at)
  VALUES ('document-1', 'case-1', 'Synthetic.pdf', 'file:///synthetic.pdf', 'PDF', ?)`).run(now);
database.prepare(`INSERT INTO ai_sources (id, case_id, document_id, file_hash, file_size, extraction_status, page_count, extracted_at, parser_version, created_at, updated_at)
  VALUES ('source-1', 'case-1', 'document-1', 'hash', 1, 'ready', 1, ?, 'parser', ?, ?)`).run(now, now, now);
database.prepare("INSERT INTO ai_threads VALUES ('thread-1', 'Synthetic', ?, ?)").run(now, now);
database.prepare("INSERT INTO ai_messages VALUES ('message-1', 'thread-1', 'user', 'Synthetic question', NULL, NULL, NULL, NULL, ?)").run(now);
const counts = database.prepare(`SELECT
  (SELECT COUNT(*) FROM ai_threads) thread_count,
  (SELECT COUNT(*) FROM ai_messages) message_count,
  (SELECT COUNT(*) FROM ai_sources WHERE extraction_status = 'ready') indexed_document_count`).get();
assert.equal(counts.thread_count, 1);
assert.equal(counts.message_count, 1);
assert.equal(counts.indexed_document_count, 1);
database.prepare('DELETE FROM ai_threads').run();
assert.equal(database.prepare('SELECT COUNT(*) count FROM ai_messages').get().count, 0);
assert.equal(database.prepare('SELECT COUNT(*) count FROM ai_sources').get().count, 1);

const appJson = JSON.parse(readFileSync('app.json', 'utf8'));
assert.equal(appJson.expo.version, '1.2.0');
assert.equal(appJson.expo.android.versionCode, 3);
assert.equal(appJson.expo.android.package, 'com.casemanagement.app');
const gradle = readFileSync('android/app/build.gradle', 'utf8');
assert.match(gradle, /versionCode 3/);
assert.match(gradle, /versionName "1\.2\.0"/);
assert.doesNotMatch(gradle, /release\s*\{[^}]*signingConfig signingConfigs\.debug/s);
assert.match(gradle, /CASE_MANAGEMENT_RELEASE_STORE_FILE/);
assert.match(gradle, /Release signing is not configured/);
assert.match(readFileSync('android/gradle.properties', 'utf8'), /reactNativeArchitectures=arm64-v8a/);
const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
assert.match(manifest, /android:usesCleartextTraffic="false"/);
assert.match(manifest, /android:networkSecurityConfig="@xml\/network_security_config"/);
assert.doesNotMatch(manifest, /SYSTEM_ALERT_WINDOW/);
assert.match(readFileSync('android/app/src/main/res/xml/backup_rules.xml', 'utf8'), /exclude domain="database" path="\."/);

const dockerfile = readFileSync('Dockerfile', 'utf8');
const dockerignore = readFileSync('.dockerignore', 'utf8');
const gitignore = readFileSync('.gitignore', 'utf8');
const renderBlueprint = readFileSync('render.yaml', 'utf8');
assert.match(dockerfile, /FROM node:22-bookworm-slim AS build/);
assert.match(dockerfile, /USER node/);
assert.match(dockerfile, /HEALTHCHECK/);
assert.doesNotMatch(dockerfile, /GEMINI_API_KEY=|SESSION_SIGNING_SECRET=/);
assert.match(dockerignore, /^server\/\.env$/m);
assert.match(dockerignore, /^\*\.keystore$/m);
assert.match(dockerignore, /^\*\.p12$/m);
assert.match(gitignore, /^server\/\.env$/m);
assert.match(gitignore, /^\*\.keystore$/m);
assert.match(gitignore, /^\*\.p12$/m);
assert.match(renderBlueprint, /^\s+runtime: docker$/m);
assert.match(renderBlueprint, /^\s+plan: free$/m);
assert.match(renderBlueprint, /^\s+region: singapore$/m);
assert.match(renderBlueprint, /^\s+autoDeployTrigger: off$/m);
assert.match(renderBlueprint, /^\s+healthCheckPath: \/health$/m);
assert.match(renderBlueprint, /key: HOST\n\s+value: 0\.0\.0\.0/);
assert.match(renderBlueprint, /key: GEMINI_API_KEY\n\s+sync: false/);
assert.match(renderBlueprint, /key: SESSION_SIGNING_SECRET\n\s+sync: false/);
assert.doesNotMatch(renderBlueprint, /(^|\n)databases:|type: (?:worker|cron|pserv|keyvalue)|disk:|keyValue|redis/i);
assert.doesNotMatch(renderBlueprint, /key: PORT/);
assert.doesNotMatch(readFileSync('docs/ADMIN_GUIDE.md', 'utf8'), /Cloud Run|Secret Manager|gcloud/i);

const backupService = readFileSync('src/services/backupService.ts', 'utf8');
assert.doesNotMatch(backupService, /ai_selected_model_id|ai_last_successful_connection_at|ai_online_consent_context/);

const scannedFiles = listFiles('.', new Set(['node_modules', '.git', 'dist', 'build', '.expo', 'release']))
  .filter((path) => path !== 'server/.env');
for (const path of scannedFiles) {
  if (!/\.(?:ts|tsx|js|mjs|json|md|xml|ya?ml|gradle|properties|example|dockerignore)$/.test(path) && !path.endsWith('Dockerfile')) continue;
  assert.doesNotMatch(readFileSync(path, 'utf8'), /AIza[0-9A-Za-z_-]{30,}/, `key-shaped value in ${path}`);
}

console.log('Prompt 5 Render Free configuration, model allowlist, Settings safety, local cleanup, release hardening, container, backup, and credential contracts passed.');

function createDatabase() {
  const value = new DatabaseSync(':memory:');
  value.exec('PRAGMA foreign_keys = ON');
  for (const statement of INITIAL_SCHEMA_STATEMENTS) value.exec(statement);
  for (const migration of [caseRemindersMigration, caseNumberAndSideMigration, aiAssistantMigration]) {
    for (const statement of migration.statements) value.exec(statement);
  }
  return value;
}

function requestInput(value) {
  return {
    requestId: value.requestId,
    threadId: value.threadId,
    question: value.question,
    selectedCaseIds: value.selectedCaseIds,
    selectedDocumentIds: value.selectedDocumentIds,
    retrievalResults: [{
      chunkId: value.evidence[0].chunkId,
      caseId: value.evidence[0].caseId,
      documentId: value.evidence[0].documentId,
      documentName: value.evidence[0].documentName,
      pageStart: value.evidence[0].pageStart,
      pageEnd: value.evidence[0].pageEnd,
      content: value.evidence[0].excerpt,
      rank: value.evidence[0].localRank,
    }],
    language: value.language,
    consentVersion: value.consent.version,
    consentGranted: true,
  };
}

function listFiles(directory, ignoredNames, prefix = '') {
  const files = [];
  for (const name of readdirSync(directory)) {
    if (ignoredNames.has(name) || name === '.DS_Store') continue;
    const path = join(directory, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...listFiles(path, ignoredNames, relative));
    else files.push(relative);
  }
  return files;
}
