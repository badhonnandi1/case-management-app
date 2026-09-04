import { Directory, File, Paths } from 'expo-file-system';

import { getTotalCaseCount } from '../repositories/caseRepository';
import { getAllDocuments } from '../repositories/documentRepository';
import {
  findMissingDocumentUris,
  findOrphanFiles,
  type StorageEntry,
} from '../utils/storage';
import { getBackupDirectory } from './backupService';
import { getCauseListDirectory } from './fileService';

export interface StorageHealthReport {
  caseCount: number;
  documentCount: number;
  documentBytes: number;
  causeListCount: number;
  causeListBytes: number;
  backupCount: number;
  backupBytes: number;
  orphanFiles: StorageEntry[];
  orphanBytes: number;
  missingDocumentCount: number;
}

export async function scanStorageHealth(): Promise<StorageHealthReport> {
  const [caseCount, documents] = await Promise.all([
    getTotalCaseCount(),
    getAllDocuments(),
  ]);
  const documentFiles = listFilesRecursively(new Directory(Paths.document, 'cases'));
  const causeListFiles = listFilesRecursively(getCauseListDirectory());
  const backupFiles = listFilesRecursively(getBackupDirectory());
  const referencedUris = documents.map((document) => document.filePath);
  const orphanFiles = findOrphanFiles(documentFiles, referencedUris);
  const missingUris = findMissingDocumentUris(documentFiles, referencedUris);

  return {
    caseCount,
    documentCount: documents.length,
    documentBytes: sumSizes(documentFiles),
    causeListCount: causeListFiles.length,
    causeListBytes: sumSizes(causeListFiles),
    backupCount: backupFiles.length,
    backupBytes: sumSizes(backupFiles),
    orphanFiles,
    orphanBytes: sumSizes(orphanFiles),
    missingDocumentCount: missingUris.length,
  };
}

export async function cleanUnusedDocumentFiles(): Promise<{ count: number; bytes: number }> {
  const documents = await getAllDocuments();
  const currentFiles = listFilesRecursively(new Directory(Paths.document, 'cases'));
  const orphanFiles = findOrphanFiles(
    currentFiles,
    documents.map((document) => document.filePath),
  );
  let deletedCount = 0;
  let deletedBytes = 0;
  for (const orphan of orphanFiles) {
    const file = new File(orphan.uri);
    if (!file.exists) continue;
    file.delete();
    deletedCount += 1;
    deletedBytes += orphan.size;
  }
  return { count: deletedCount, bytes: deletedBytes };
}

export function deleteGeneratedCauseLists(): number {
  const files = listFilesRecursively(getCauseListDirectory());
  for (const file of files) {
    const storedFile = new File(file.uri);
    if (storedFile.exists) storedFile.delete();
  }
  return files.length;
}

function listFilesRecursively(directory: Directory): StorageEntry[] {
  if (!directory.exists) return [];
  const result: StorageEntry[] = [];
  for (const entry of directory.list()) {
    if (entry instanceof File) {
      result.push({ uri: entry.uri, size: entry.size });
    } else {
      result.push(...listFilesRecursively(entry));
    }
  }
  return result;
}

function sumSizes(files: readonly StorageEntry[]): number {
  return files.reduce((total, file) => total + file.size, 0);
}
