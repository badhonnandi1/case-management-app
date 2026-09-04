import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Unzip, UnzipInflate, Zip, ZipPassThrough, strToU8 } from 'fflate';

import { LATEST_SCHEMA_VERSION } from '../database/migrations';
import type {
  BackupData,
  CreatedBackup,
  PortableDocument,
  RestoreResult,
  ValidatedBackup,
} from '../models/Backup';
import type { CaseDocument } from '../models/CaseDocument';
import { replaceAllPortableData } from '../repositories/backupRepository';
import { getAllCaseHistory } from '../repositories/caseHistoryRepository';
import { getAllCases } from '../repositories/caseRepository';
import { getAllDocuments } from '../repositories/documentRepository';
import { getAllSettings } from '../repositories/settingsRepository';
import {
  buildPortableDocumentPath,
  buildRestoredDocumentFileName,
  createBackupManifest,
  isSafeBackupArchivePath,
  serializeBackupJson,
  validateBackupBundle,
} from '../utils/backup';
import { sanitizePathSegment } from '../utils/file';
import { createId } from '../utils/id';
import {
  cancelAllCaseRemindersIfNeeded,
  REMINDER_DAYS_KEY,
  REMINDERS_ENABLED_KEY,
  REMINDER_TIME_KEY,
  syncScheduledReminders,
} from './notificationService';
import { representedSideLabel } from '../utils/caseFormat';

const ARCHIVE_CHUNK_SIZE = 128 * 1024;
const PORTABLE_SETTING_KEYS = new Set([
  REMINDERS_ENABLED_KEY,
  REMINDER_DAYS_KEY,
  REMINDER_TIME_KEY,
]);

export type BackupPickerResult =
  | { status: 'cancelled' }
  | { status: 'validated'; backup: ValidatedBackup };

export function getBackupDirectory(): Directory {
  const directory = new Directory(Paths.document, 'backups');
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

export function listCreatedBackups(): File[] {
  const directory = getBackupDirectory();
  return directory
    .list()
    .filter((entry): entry is File => entry instanceof File && entry.name.endsWith('.casebackup'))
    .sort((left, right) => (right.modificationTime ?? 0) - (left.modificationTime ?? 0));
}

export function getLatestBackup(): File | null {
  return listCreatedBackups()[0] ?? null;
}

export async function createPortableBackup(): Promise<CreatedBackup> {
  const [cases, caseHistory, allDocuments, allSettings] = await Promise.all([
    getAllCases(),
    getAllCaseHistory(),
    getAllDocuments(),
    getAllSettings(),
  ]);
  const portableDocuments: PortableDocument[] = [];
  const sourceByArchivePath = new Map<string, File>();
  let skippedDocumentCount = 0;

  for (const document of allDocuments) {
    const source = new File(document.filePath);
    if (!source.exists) {
      skippedDocumentCount += 1;
      continue;
    }
    const storedName = document.filePath || document.fileName;
    const archivePath = buildPortableDocumentPath(
      document.caseId,
      document.id,
      storedName,
    );
    portableDocuments.push({
      id: document.id,
      caseId: document.caseId,
      fileName: document.fileName,
      archivePath,
      fileType: document.fileType,
      description: document.description,
      createdAt: document.createdAt,
    });
    sourceByArchivePath.set(archivePath, source);
  }

  const data: BackupData = {
    cases: [...cases].sort((a, b) => a.id.localeCompare(b.id)),
    caseHistory: [...caseHistory].sort((a, b) => a.id.localeCompare(b.id)),
    documents: portableDocuments.sort((a, b) => a.id.localeCompare(b.id)),
    settings: allSettings
      .filter((setting) => PORTABLE_SETTING_KEYS.has(setting.key))
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
  const createdAt = new Date().toISOString();
  const manifest = createBackupManifest(
    data,
    getAppVersion(),
    LATEST_SCHEMA_VERSION,
    createdAt,
    skippedDocumentCount,
  );
  const destination = getAvailableBackupFile(createdAt);
  destination.create();

  try {
    writeArchive(destination, data, manifest, sourceByArchivePath);
    if (!destination.exists || destination.size <= 0) {
      throw new Error('The backup archive was not created.');
    }
    return {
      uri: destination.uri,
      fileName: destination.name,
      size: destination.size,
      manifest,
    };
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  }
}

export async function shareBackup(uri: string): Promise<void> {
  const file = new File(uri);
  if (!file.exists) throw new Error('The backup file is missing.');
  if (!(await Sharing.isAvailableAsync())) throw new Error('File sharing is unavailable.');
  await Sharing.shareAsync(file.uri, {
    dialogTitle: 'Share Case Management backup',
    mimeType: 'application/octet-stream',
  });
}

export async function createAndShareCaseCsv(): Promise<{ fileName: string; caseCount: number }> {
  const cases = await getAllCases();
  const directory = new Directory(Paths.document, 'exports');
  directory.create({ intermediates: true, idempotent: true });
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
  const file = new File(directory, `Case_Data_${stamp}.csv`);
  const headers = [
    'Case Type', 'Case Number', 'Case Year', 'Full Case Number', 'Court Name',
    'Case Title', 'Represented Side', 'Party Name', 'Opposite Party Name',
    'Judge Name', 'Previous Date', 'Previous Order', 'Next Date', 'Today Step',
    'Status', 'Notes', 'Created At', 'Updated At',
  ];
  const rows = cases.map((item) => [
    item.caseType, item.caseSerial, item.caseYear, item.caseNumber, item.courtName,
    item.caseTitle, representedSideLabel(item.representedSide), item.partyName,
    item.oppositePartyName, item.judgeName, item.previousDate, item.previousOrder,
    item.nextDate, item.nextStep, item.status, item.notes, item.createdAt, item.updatedAt,
  ]);
  file.create({ overwrite: true });
  file.write(`\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`);
  if (!file.exists || file.size <= 0) throw new Error('The CSV export was not created.');
  if (!(await Sharing.isAvailableAsync())) throw new Error('File sharing is unavailable.');
  await Sharing.shareAsync(file.uri, {
    dialogTitle: 'Share Case Management Excel-compatible CSV',
    mimeType: 'text/csv',
  });
  return { fileName: file.name, caseCount: cases.length };
}

function csvCell(value: string | null | undefined): string {
  const text = value ?? '';
  return `"${text.replace(/"/g, '""')}"`;
}

export async function selectAndValidateBackup(): Promise<BackupPickerResult> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/octet-stream', 'application/zip', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return { status: 'cancelled' };
  const asset = result.assets[0];
  if (!asset) throw new Error('No backup file was selected.');
  return { status: 'validated', backup: validateBackupArchive(asset.uri) };
}

export function validateBackupArchive(uri: string): ValidatedBackup {
  const source = new File(uri);
  if (!source.exists) throw new Error('The selected backup file is unavailable.');
  const staging = new Directory(Paths.cache, `case-restore-${sanitizePathSegment(createId())}`);
  staging.create({ intermediates: true });

  try {
    extractArchive(source, staging);
    const manifestFile = new File(staging, 'manifest.json');
    const dataFile = new File(staging, 'data.json');
    if (!manifestFile.exists || !dataFile.exists) {
      throw new Error('The selected file is not a valid Case Management backup.');
    }
    const bundle = validateBackupBundle(
      parseJson(manifestFile.textSync(), 'Backup manifest is unreadable.'),
      parseJson(dataFile.textSync(), 'Backup data is unreadable.'),
      LATEST_SCHEMA_VERSION,
    );
    for (const document of bundle.data.documents) {
      const archivedFile = resolveStagingFile(staging, document.archivePath);
      if (!archivedFile.exists) throw new Error(`A backed-up document is missing: ${document.fileName}`);
    }
    return { ...bundle, stagingDirectoryUri: staging.uri };
  } catch (error) {
    if (staging.exists) staging.delete();
    throw error;
  }
}

export function discardValidatedBackup(backup: ValidatedBackup): void {
  const staging = new Directory(backup.stagingDirectoryUri);
  try {
    if (staging.exists) staging.delete();
  } catch (error) {
    console.error('Unable to remove temporary restore files.', error);
  }
}

export async function restoreValidatedBackup(backup: ValidatedBackup): Promise<RestoreResult> {
  const staging = new Directory(backup.stagingDirectoryUri);
  if (!staging.exists) throw new Error('The prepared backup is no longer available.');
  const restoreToken = sanitizePathSegment(createId());
  const preparedFiles: File[] = [];
  let databaseCommitted = false;
  let reminderWarning = false;
  let cleanupWarning = false;

  try {
    await cancelAllCaseRemindersIfNeeded();
    const restoredDocuments = prepareRestoredDocuments(
      backup.data.documents,
      staging,
      restoreToken,
      preparedFiles,
    );
    await replaceAllPortableData(backup.data, restoredDocuments);
    databaseCommitted = true;

    try {
      removeObsoleteDocumentFiles(new Set(restoredDocuments.map((document) => document.filePath)));
    } catch (error) {
      cleanupWarning = true;
      console.error('Restore completed, but obsolete document files could not all be removed.', error);
    }

    try {
      await syncScheduledReminders();
    } catch (error) {
      reminderWarning = true;
      console.error('Restore completed, but hearing reminders could not be reconciled.', error);
    }

    return {
      caseCount: backup.data.cases.length,
      historyCount: backup.data.caseHistory.length,
      documentCount: restoredDocuments.length,
      cleanupWarning,
      reminderWarning,
    };
  } catch (error) {
    if (!databaseCommitted) {
      for (const file of preparedFiles) {
        try {
          if (file.exists) file.delete();
        } catch {
          // Best-effort rollback of files that were not activated in SQLite.
        }
      }
      try {
        await syncScheduledReminders();
      } catch {
        // The original database remains intact; startup reconciliation will retry.
      }
    }
    throw error;
  } finally {
    try {
      if (staging.exists) staging.delete();
    } catch (error) {
      console.error('Unable to remove temporary restore files.', error);
    }
  }
}

function writeArchive(
  destination: File,
  data: BackupData,
  manifest: ReturnType<typeof createBackupManifest>,
  sourceByArchivePath: ReadonlyMap<string, File>,
): void {
  const output = destination.open(FileMode.WriteOnly);
  let archiveError: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error) {
      archiveError = error;
      return;
    }
    output.writeBytes(chunk);
  });

  try {
    addTextEntry(zip, 'manifest.json', serializeBackupJson(manifest));
    addTextEntry(zip, 'data.json', serializeBackupJson(data));
    for (const document of data.documents) {
      const source = sourceByArchivePath.get(document.archivePath);
      if (!source) throw new Error('A document selected for backup became unavailable.');
      addFileEntry(zip, document.archivePath, source);
      if (archiveError) throw archiveError;
    }
    zip.end();
    if (archiveError) throw archiveError;
  } finally {
    output.close();
  }
}

function addTextEntry(zip: Zip, name: string, value: string): void {
  const entry = new ZipPassThrough(name);
  zip.add(entry);
  entry.push(strToU8(value), true);
}

function addFileEntry(zip: Zip, name: string, source: File): void {
  const entry = new ZipPassThrough(name);
  zip.add(entry);
  const input = source.open(FileMode.ReadOnly);
  try {
    const size = input.size ?? 0;
    if (size === 0) {
      entry.push(new Uint8Array(0), true);
      return;
    }
    let remaining = size;
    while (remaining > 0) {
      const chunk = input.readBytes(Math.min(ARCHIVE_CHUNK_SIZE, remaining));
      remaining -= chunk.byteLength;
      entry.push(chunk, remaining === 0);
    }
  } finally {
    input.close();
  }
}

function extractArchive(source: File, destination: Directory): void {
  let extractionError: Error | null = null;
  let activeFiles = 0;
  const entryNames = new Set<string>();
  const unzip = new Unzip((entry) => {
    if (extractionError) return;
    if (!isSafeBackupArchivePath(entry.name) || !isAllowedArchiveEntry(entry.name)) {
      extractionError = new Error('Backup contains an unsafe or unexpected file path.');
      entry.terminate();
      return;
    }
    if (entryNames.has(entry.name)) {
      extractionError = new Error('Backup contains duplicate archive entries.');
      entry.terminate();
      return;
    }
    entryNames.add(entry.name);
    activeFiles += 1;
    const outputFile = resolveStagingFile(destination, entry.name, true);
    const output = outputFile.open(FileMode.WriteOnly);
    entry.ondata = (error, chunk, final) => {
      if (error) {
        extractionError = error;
        output.close();
        return;
      }
      output.writeBytes(chunk);
      if (final) {
        output.close();
        activeFiles -= 1;
      }
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  const input = source.open(FileMode.ReadOnly);
  try {
    const size = input.size ?? 0;
    if (size <= 0) throw new Error('The selected backup is empty.');
    let remaining = size;
    while (remaining > 0 && !extractionError) {
      const chunk = input.readBytes(Math.min(ARCHIVE_CHUNK_SIZE, remaining));
      remaining -= chunk.byteLength;
      unzip.push(chunk, remaining === 0);
    }
  } finally {
    input.close();
  }
  if (extractionError) throw extractionError;
  if (activeFiles !== 0) throw new Error('The selected backup archive is incomplete.');
}

function resolveStagingFile(root: Directory, archivePath: string, create = false): File {
  const parts = archivePath.split('/');
  const fileName = parts.pop();
  if (!fileName) throw new Error('Backup contains an invalid file path.');
  let directory = root;
  for (const part of parts) {
    directory = new Directory(directory, part);
    if (create) directory.create({ intermediates: true, idempotent: true });
  }
  const file = new File(directory, fileName);
  if (create) file.create();
  return file;
}

function prepareRestoredDocuments(
  documents: readonly PortableDocument[],
  staging: Directory,
  restoreToken: string,
  preparedFiles: File[],
): CaseDocument[] {
  return documents.map((document) => {
    const source = resolveStagingFile(staging, document.archivePath);
    if (!source.exists) throw new Error(`A backed-up document is missing: ${document.fileName}`);
    const directory = new Directory(
      Paths.document,
      'cases',
      sanitizePathSegment(document.caseId),
      'documents',
    );
    directory.create({ intermediates: true, idempotent: true });
    const destination = new File(
      directory,
      buildRestoredDocumentFileName(restoreToken, document.id, document.archivePath),
    );
    preparedFiles.push(destination);
    source.copy(destination);
    if (!destination.exists) throw new Error('A restored document could not be prepared.');
    return {
      id: document.id,
      caseId: document.caseId,
      fileName: document.fileName,
      filePath: destination.uri,
      fileType: document.fileType,
      description: document.description,
      createdAt: document.createdAt,
    };
  });
}

function removeObsoleteDocumentFiles(activeUris: ReadonlySet<string>): void {
  const casesDirectory = new Directory(Paths.document, 'cases');
  if (!casesDirectory.exists) return;
  for (const file of listFilesRecursively(casesDirectory)) {
    if (!activeUris.has(file.uri)) file.delete();
  }
}

function listFilesRecursively(directory: Directory): File[] {
  const result: File[] = [];
  for (const entry of directory.list()) {
    if (entry instanceof File) result.push(entry);
    else result.push(...listFilesRecursively(entry));
  }
  return result;
}

function getAvailableBackupFile(createdAt: string): File {
  const date = createdAt.slice(0, 10);
  const time = createdAt.slice(11, 19).replace(/:/g, '');
  const baseName = `Case_Backup_${date}_${time}.casebackup`;
  const directory = getBackupDirectory();
  let attempt = 1;
  let file = new File(directory, baseName);
  while (file.exists) {
    attempt += 1;
    file = new File(directory, baseName.replace('.casebackup', `_${attempt}.casebackup`));
  }
  return file;
}

function isAllowedArchiveEntry(path: string): boolean {
  return path === 'manifest.json' || path === 'data.json' || path.startsWith('documents/cases/');
}

function parseJson(value: string, message: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(message);
  }
}

function getAppVersion(): string {
  return Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? 'Unknown';
}
