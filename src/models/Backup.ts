import type { AppSettings } from './AppSettings';
import type { Case } from './Case';
import type { CaseHistory } from './CaseHistory';
import type { DocumentFileType } from './CaseDocument';
import type { Court } from './Court';
import type { CaseTask } from './CaseTask';

export interface BackupManifest {
  backupFormatVersion: 1;
  createdAt: string;
  appVersion: string;
  databaseSchemaVersion: number;
  caseCount: number;
  historyCount: number;
  documentCount: number;
  skippedDocumentCount: number;
  courtCount: number;
  taskCount: number;
}

export interface PortableDocument {
  id: string;
  caseId: string;
  fileName: string;
  archivePath: string;
  fileType: DocumentFileType;
  description: string | null;
  createdAt: string;
}

export interface BackupData {
  cases: Case[];
  courts: Court[];
  caseHistory: CaseHistory[];
  caseTasks: CaseTask[];
  documents: PortableDocument[];
  settings: AppSettings[];
}

export interface BackupBundle {
  manifest: BackupManifest;
  data: BackupData;
}

export interface CreatedBackup {
  uri: string;
  fileName: string;
  size: number;
  manifest: BackupManifest;
}

export interface ValidatedBackup extends BackupBundle {
  stagingDirectoryUri: string;
}

export interface RestoreResult {
  caseCount: number;
  historyCount: number;
  documentCount: number;
  courtCount: number;
  taskCount: number;
  cleanupWarning: boolean;
  reminderWarning: boolean;
}
