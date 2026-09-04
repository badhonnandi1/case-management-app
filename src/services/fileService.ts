import { Directory, File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';

import type { DocumentFileType } from '../models/CaseDocument';
import { createId } from '../utils/id';
import {
  buildCollisionFileName,
  normalizeFileExtension,
  sanitizePathSegment,
} from '../utils/file';

const READ_URI_PERMISSION_FLAG = 1;

export function ensureCaseDocumentDirectory(caseId: string): Directory {
  const directory = new Directory(
    Paths.document,
    'cases',
    sanitizePathSegment(caseId),
    'documents',
  );
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

export async function copyPickedFileToCaseStorage(
  sourceUri: string,
  caseId: string,
  extension: string,
): Promise<string> {
  const directory = ensureCaseDocumentDirectory(caseId);
  const safeExtension = normalizeFileExtension(extension, '.bin');
  const destination = new File(directory, `${createId()}${safeExtension}`);
  await new File(sourceUri).copy(destination);
  if (!destination.exists) throw new Error('The selected file could not be copied.');
  return destination.uri;
}

export function checkFileExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

export function deleteStoredFile(uri: string): void {
  const file = new File(uri);
  if (file.exists) file.delete();
}

export function deleteCaseStorage(caseId: string): void {
  const directory = new Directory(Paths.document, 'cases', sanitizePathSegment(caseId));
  if (directory.exists) directory.delete();
}

export async function shareFile(
  uri: string,
  fileType: DocumentFileType = 'PDF',
): Promise<void> {
  if (!checkFileExists(uri)) throw new Error('The file is missing from local storage.');
  if (!(await Sharing.isAvailableAsync())) throw new Error('File sharing is unavailable.');
  await Sharing.shareAsync(uri, {
    dialogTitle: 'Share file',
    mimeType: fileType === 'PDF' ? 'application/pdf' : getImageMimeType(uri),
  });
}

export async function openPdf(uri: string): Promise<void> {
  const file = new File(uri);
  if (!file.exists) throw new Error('The PDF is missing from local storage.');
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: file.contentUri,
    type: 'application/pdf',
    flags: READ_URI_PERMISSION_FLAG,
  });
}

export function getCauseListDirectory(): Directory {
  const directory = new Directory(Paths.document, 'cause-lists');
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

export function getAvailableCauseListFile(baseName: string): File {
  const directory = getCauseListDirectory();
  let attempt = 1;
  let file = new File(directory, buildCollisionFileName(baseName, attempt));
  while (file.exists) {
    attempt += 1;
    file = new File(directory, buildCollisionFileName(baseName, attempt));
  }
  return file;
}

function getImageMimeType(uri: string): string {
  const extension = uri.toLowerCase().split(/[?#]/, 1)[0]?.split('.').pop();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'heic' || extension === 'heif') return 'image/heic';
  return 'image/jpeg';
}
