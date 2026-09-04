import type { AppSettings } from '../models/AppSettings';
import type {
  BackupBundle,
  BackupData,
  BackupManifest,
  PortableDocument,
} from '../models/Backup';
import { REPRESENTED_SIDE_OPTIONS, type Case, type CaseStatus } from '../models/Case.ts';
import type { CaseHistory, PaymentStatus } from '../models/CaseHistory';
import type { Court } from '../models/Court';
import type { CaseTask } from '../models/CaseTask';
const CASE_STATUSES = new Set<CaseStatus>(['ACTIVE', 'PENDING', 'CLOSED']);
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_EXTENSION_PATTERN = /^\.[a-z0-9]{1,10}$/;
const PORTABLE_SETTING_KEYS = new Set([
  'reminders_enabled',
  'reminder_days_before',
  'reminder_time',
]);
export const BACKUP_FORMAT_VERSION = 1 as const;

export function createBackupManifest(
  data: BackupData,
  appVersion: string,
  databaseSchemaVersion: number,
  createdAt = new Date().toISOString(),
  skippedDocumentCount = 0,
): BackupManifest {
  return {
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    createdAt,
    appVersion,
    databaseSchemaVersion,
    caseCount: data.cases.length,
    historyCount: data.caseHistory.length,
    documentCount: data.documents.length,
    skippedDocumentCount,
    courtCount: data.courts?.length ?? 0,
    taskCount: data.caseTasks?.length ?? 0,
  };
}

export function buildPortableDocumentPath(
  caseId: string,
  documentId: string,
  fileName: string,
): string {
  const extension = getBackupFileExtension(fileName) || '.bin';
  return `documents/cases/${sanitizeBackupPathSegment(caseId)}/${sanitizeBackupPathSegment(documentId)}${extension}`;
}

export function buildRestoredDocumentFileName(
  restoreToken: string,
  documentId: string,
  archivePath: string,
): string {
  const extension = getBackupFileExtension(archivePath) || '.bin';
  return `${sanitizeBackupPathSegment(restoreToken)}-${sanitizeBackupPathSegment(documentId)}${extension}`;
}

export function isSafeBackupArchivePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  const parts = path.split('/');
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..');
}

export function serializeBackupJson(value: BackupManifest | BackupData): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function validateBackupBundle(
  manifestValue: unknown,
  dataValue: unknown,
  currentSchemaVersion: number,
): BackupBundle {
  const manifest = validateManifest(manifestValue, currentSchemaVersion);
  const dataObject = requireRecord(dataValue, 'Backup data is invalid.');
  const cases = requireArray(dataObject.cases, 'Cases are missing.').map(validateCase);
  const caseIds = ensureUniqueIds(cases, 'case');
  const courts = optionalArray(dataObject.courts).map(validateCourt);
  const courtIds = ensureUniqueIds(courts, 'court');
  for (const caseItem of cases) {
    if (caseItem.courtId && !courtIds.has(caseItem.courtId)) {
      throw new Error('A case references a missing court.');
    }
  }
  const caseHistory = requireArray(
    dataObject.caseHistory,
    'Hearing history is missing.',
  ).map((value) => validateHistory(value, caseIds));
  ensureUniqueIds(caseHistory, 'hearing record');
  const caseTasks = optionalArray(dataObject.caseTasks).map((value) => validateTask(value, caseIds));
  ensureUniqueIds(caseTasks, 'task');
  const documents = requireArray(dataObject.documents, 'Documents are missing.').map(
    (value) => validateDocument(value, caseIds),
  );
  ensureUniqueIds(documents, 'document');
  const documentPaths = new Set<string>();
  for (const document of documents) {
    if (documentPaths.has(document.archivePath)) {
      throw new Error('Backup contains duplicate document archive paths.');
    }
    documentPaths.add(document.archivePath);
  }
  const settings = requireArray(dataObject.settings, 'Settings are missing.').map(validateSetting);
  ensureUniqueIds(settings, 'setting');
  const settingKeys = new Set<string>();
  for (const setting of settings) {
    if (settingKeys.has(setting.key)) throw new Error('Backup contains duplicate setting keys.');
    settingKeys.add(setting.key);
  }

  if (
    manifest.caseCount !== cases.length ||
    manifest.historyCount !== caseHistory.length ||
    manifest.documentCount !== documents.length
    || manifest.courtCount !== courts.length
    || manifest.taskCount !== caseTasks.length
  ) {
    throw new Error('Backup record counts do not match the manifest.');
  }

  return { manifest, data: { cases, courts, caseHistory, caseTasks, documents, settings } };
}

function validateManifest(value: unknown, currentSchemaVersion: number): BackupManifest {
  const record = requireRecord(value, 'Backup manifest is invalid.');
  const version = requireInteger(record.backupFormatVersion, 'Backup format version is invalid.');
  if (version !== BACKUP_FORMAT_VERSION) {
    throw new Error('This backup format is not supported by this version of the app.');
  }
  const databaseSchemaVersion = requireNonNegativeInteger(
    record.databaseSchemaVersion,
    'Database schema version is invalid.',
  );
  if (databaseSchemaVersion > currentSchemaVersion) {
    throw new Error('This backup was created by a newer version of the app.');
  }
  return {
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    createdAt: requireTimestamp(record.createdAt, 'Backup creation date is invalid.'),
    appVersion: requireNonEmptyString(record.appVersion, 'App version is missing.'),
    databaseSchemaVersion,
    caseCount: requireNonNegativeInteger(record.caseCount, 'Case count is invalid.'),
    historyCount: requireNonNegativeInteger(record.historyCount, 'History count is invalid.'),
    documentCount: requireNonNegativeInteger(record.documentCount, 'Document count is invalid.'),
    skippedDocumentCount: record.skippedDocumentCount === undefined
      ? 0
      : requireNonNegativeInteger(record.skippedDocumentCount, 'Skipped document count is invalid.'),
    courtCount: record.courtCount === undefined
      ? 0
      : requireNonNegativeInteger(record.courtCount, 'Court count is invalid.'),
    taskCount: record.taskCount === undefined
      ? 0
      : requireNonNegativeInteger(record.taskCount, 'Task count is invalid.'),
  };
}

function validateCase(value: unknown): Case {
  const record = requireRecord(value, 'A case record is invalid.');
  const status = requireNonEmptyString(record.status, 'A case status is missing.');
  if (!CASE_STATUSES.has(status as CaseStatus)) throw new Error('Backup contains an invalid case status.');
  return {
    id: requireNonEmptyString(record.id, 'A case ID is missing.'),
    caseNumber: requireNonEmptyString(record.caseNumber, 'A case number is missing.'),
    caseType: requireOptionalPortableString(record.caseType, 'A case type is invalid.'),
    caseSerial: requireOptionalPortableString(record.caseSerial, 'A case serial is invalid.'),
    caseYear: requireOptionalPortableString(record.caseYear, 'A case year is invalid.'),
    caseTitle: requireNonEmptyString(record.caseTitle, 'A case title is missing.'),
    partyName: requireNonEmptyString(record.partyName, 'A party name is missing.'),
    oppositePartyName: requireString(record.oppositePartyName, 'An opposite party value is invalid.'),
    representedSide: validateRepresentedSide(record.representedSide),
    courtId: requireOptionalPortableString(record.courtId, 'A court reference is invalid.'),
    courtName: requireNonEmptyString(record.courtName, 'A court name is missing.'),
    courtShortCode: requireOptionalPortableString(record.courtShortCode, 'A court short code is invalid.'),
    judgeName: requireNullableString(record.judgeName, 'A judge value is invalid.'),
    previousDate: requireOptionalDate(record.previousDate, 'A previous date is invalid.'),
    nextDate: requireOptionalDate(record.nextDate, 'A next hearing date is invalid.'),
    previousOrder: requireNullableString(record.previousOrder, 'A previous order is invalid.'),
    nextStep: requireNullableString(record.nextStep, 'A next step is invalid.'),
    status: status as CaseStatus,
    notes: requireNullableString(record.notes, 'Case notes are invalid.'),
    createdAt: requireTimestamp(record.createdAt, 'A case creation date is invalid.'),
    updatedAt: requireTimestamp(record.updatedAt, 'A case update date is invalid.'),
  };
}

function requireOptionalPortableString(value: unknown, message: string): string | null {
  if (value === undefined || value === null) return null;
  return requireNullableString(value, message);
}

function validateRepresentedSide(value: unknown): Case['representedSide'] {
  if (value === undefined || value === null) return null;
  if (!REPRESENTED_SIDE_OPTIONS.some((option) => option.value === value)) {
    throw new Error('Backup contains an invalid represented side.');
  }
  return value as Case['representedSide'];
}

function validateHistory(value: unknown, caseIds: Set<string>): CaseHistory {
  const record = requireRecord(value, 'A hearing record is invalid.');
  const caseId = requireNonEmptyString(record.caseId, 'A hearing case ID is missing.');
  if (!caseIds.has(caseId)) throw new Error('A hearing record references a missing case.');
  const paymentStatus = validatePaymentStatus(record.paymentStatus);
  const paymentAmountMinor = requireOptionalNonNegativeInteger(record.paymentAmountMinor, 'A payment amount is invalid.');
  if (paymentStatus !== 'PAID' && paymentAmountMinor !== null) {
    throw new Error('A payment amount requires Paid status.');
  }
  return {
    id: requireNonEmptyString(record.id, 'A hearing record ID is missing.'),
    caseId,
    hearingDate: requireDate(record.hearingDate, 'A hearing date is invalid.'),
    orderText: requireNullableString(record.orderText, 'A hearing order is invalid.'),
    nextStep: requireNullableString(record.nextStep, 'A hearing next step is invalid.'),
    nextDate: requireOptionalDate(record.nextDate, 'A hearing next date is invalid.'),
    notes: requireNullableString(record.notes, 'Hearing notes are invalid.'),
    paymentStatus,
    paymentAmountMinor,
    paymentNote: requireOptionalPortableString(record.paymentNote, 'A payment note is invalid.'),
    createdAt: requireTimestamp(record.createdAt, 'A hearing creation date is invalid.'),
  };
}

function validateCourt(value: unknown): Court {
  const record = requireRecord(value, 'A court record is invalid.');
  return {
    id: requireNonEmptyString(record.id, 'A court ID is missing.'),
    fullName: requireNonEmptyString(record.fullName, 'A court name is missing.'),
    shortCode: requireNonEmptyString(record.shortCode, 'A court short code is missing.'),
    createdAt: requireTimestamp(record.createdAt, 'A court creation date is invalid.'),
    updatedAt: requireTimestamp(record.updatedAt, 'A court update date is invalid.'),
  };
}

function validateTask(value: unknown, caseIds: Set<string>): CaseTask {
  const record = requireRecord(value, 'A task record is invalid.');
  const caseId = requireNonEmptyString(record.caseId, 'A task case ID is missing.');
  if (!caseIds.has(caseId)) throw new Error('A task references a missing case.');
  const completed = requireBoolean(record.completed, 'A task completion state is invalid.');
  const completedAt = requireOptionalTimestamp(record.completedAt, 'A task completion date is invalid.');
  if (completed !== Boolean(completedAt)) throw new Error('A task has inconsistent completion data.');
  return {
    id: requireNonEmptyString(record.id, 'A task ID is missing.'),
    caseId,
    title: requireNonEmptyString(record.title, 'A task title is missing.'),
    note: requireOptionalPortableString(record.note, 'A task note is invalid.'),
    dueDate: requireOptionalDate(record.dueDate, 'A task due date is invalid.'),
    completed,
    createdAt: requireTimestamp(record.createdAt, 'A task creation date is invalid.'),
    completedAt,
    updatedAt: requireTimestamp(record.updatedAt, 'A task update date is invalid.'),
  };
}

function validatePaymentStatus(value: unknown): PaymentStatus | null {
  if (value === undefined || value === null) return null;
  if (value !== 'PAID' && value !== 'UNPAID') throw new Error('A payment status is invalid.');
  return value;
}

function validateDocument(value: unknown, caseIds: Set<string>): PortableDocument {
  const record = requireRecord(value, 'A document record is invalid.');
  const id = requireNonEmptyString(record.id, 'A document ID is missing.');
  const caseId = requireNonEmptyString(record.caseId, 'A document case ID is missing.');
  if (!caseIds.has(caseId)) throw new Error('A document references a missing case.');
  const archivePath = requireNonEmptyString(record.archivePath, 'A document archive path is missing.');
  if (!isSafeBackupArchivePath(archivePath) || !archivePath.startsWith('documents/cases/')) {
    throw new Error('A document archive path is unsafe.');
  }
  const expectedDirectory = `documents/cases/${sanitizeBackupPathSegment(caseId)}/`;
  if (!archivePath.startsWith(expectedDirectory)) {
    throw new Error('A document archive path does not match its case.');
  }
  const archivedName = archivePath.slice(expectedDirectory.length);
  if (!archivedName.startsWith(`${sanitizeBackupPathSegment(id)}.`)) {
    throw new Error('A document archive path does not match its document ID.');
  }
  const fileType = requireNonEmptyString(record.fileType, 'A document type is missing.');
  if (fileType !== 'PDF' && fileType !== 'IMAGE') throw new Error('Backup contains an invalid document type.');
  return {
    id,
    caseId,
    fileName: requireNonEmptyString(record.fileName, 'A document name is missing.'),
    archivePath,
    fileType,
    description: requireNullableString(record.description, 'A document description is invalid.'),
    createdAt: requireTimestamp(record.createdAt, 'A document creation date is invalid.'),
  };
}

function validateSetting(value: unknown): AppSettings {
  const record = requireRecord(value, 'A setting record is invalid.');
  const setting = {
    id: requireNonEmptyString(record.id, 'A setting ID is missing.'),
    key: requireNonEmptyString(record.key, 'A setting key is missing.'),
    value: requireString(record.value, 'A setting value is invalid.'),
    updatedAt: requireTimestamp(record.updatedAt, 'A setting date is invalid.'),
  };
  if (!PORTABLE_SETTING_KEYS.has(setting.key)) {
    throw new Error('Backup contains an unsupported setting.');
  }
  if (setting.key === 'reminders_enabled' && setting.value !== 'true' && setting.value !== 'false') {
    throw new Error('Backup contains an invalid reminder setting.');
  }
  if (setting.key === 'reminder_days_before' && !['0', '1', '3', '7'].includes(setting.value)) {
    throw new Error('Backup contains an invalid reminder interval.');
  }
  if (setting.key === 'reminder_time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(setting.value)) {
    throw new Error('Backup contains an invalid reminder time.');
  }
  return setting;
}

function ensureUniqueIds<T extends { id: string }>(items: T[], label: string): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`Backup contains a duplicate ${label} ID.`);
    ids.add(item.id);
  }
  return ids;
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(message);
  return value;
}

function optionalArray(value: unknown): unknown[] {
  return value === undefined ? [] : requireArray(value, 'Optional backup data is invalid.');
}

function requireBoolean(value: unknown, message: string): boolean {
  if (typeof value !== 'boolean') throw new Error(message);
  return value;
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string') throw new Error(message);
  return value;
}

function requireNonEmptyString(value: unknown, message: string): string {
  const result = requireString(value, message);
  if (!result.trim()) throw new Error(message);
  return result;
}

function requireNullableString(value: unknown, message: string): string | null {
  if (value === null) return null;
  return requireString(value, message);
}

function requireDate(value: unknown, message: string): string {
  const result = requireNonEmptyString(value, message);
  if (!isValidPortableDate(result)) throw new Error(message);
  return result;
}

function requireOptionalDate(value: unknown, message: string): string | null {
  if (value === null) return null;
  return requireDate(value, message);
}

function requireTimestamp(value: unknown, message: string): string {
  const result = requireNonEmptyString(value, message);
  if (!ISO_DATE_PATTERN.test(result) || Number.isNaN(Date.parse(result))) throw new Error(message);
  return result;
}

function requireInteger(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(message);
  return value;
}

function requireNonNegativeInteger(value: unknown, message: string): number {
  const result = requireInteger(value, message);
  if (result < 0) throw new Error(message);
  return result;
}

function requireOptionalNonNegativeInteger(value: unknown, message: string): number | null {
  if (value === undefined || value === null) return null;
  return requireNonNegativeInteger(value, message);
}

function requireOptionalTimestamp(value: unknown, message: string): string | null {
  if (value === undefined || value === null) return null;
  return requireTimestamp(value, message);
}

function isValidPortableDate(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) return false;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function getBackupFileExtension(value: string): string {
  const cleanValue = value.split(/[?#]/, 1)[0] ?? '';
  const lastSegment = cleanValue.split('/').pop() ?? '';
  const dotIndex = lastSegment.lastIndexOf('.');
  if (dotIndex <= 0) return '';
  const extension = lastSegment.slice(dotIndex).toLowerCase();
  return SAFE_EXTENSION_PATTERN.test(extension) ? extension : '';
}

function sanitizeBackupPathSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!sanitized) throw new Error('A valid storage identifier is required.');
  return sanitized;
}
