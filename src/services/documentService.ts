import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

import type { CaseDocument, DocumentFileType } from '../models/CaseDocument';
import {
  createDocument,
  deleteDocument,
  getDocumentById,
  updateDocument,
} from '../repositories/documentRepository';
import { getFileExtension, normalizeDisplayFilename, normalizeFileExtension } from '../utils/file';
import { copyPickedFileToCaseStorage, deleteStoredFile } from './fileService';

export type DocumentImportResult =
  | { status: 'saved'; document: CaseDocument }
  | { status: 'cancelled' }
  | { status: 'permission-denied' };

export async function choosePdfForCase(caseId: string): Promise<DocumentImportResult> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/pdf',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return { status: 'cancelled' };
  const asset = result.assets[0];
  if (!asset) throw new Error('No PDF was selected.');
  if (asset.mimeType !== 'application/pdf' && getFileExtension(asset.name) !== '.pdf') {
    throw new Error('Please choose a valid PDF file.');
  }
  return saveImportedDocument(caseId, asset.uri, asset.name, 'PDF', '.pdf');
}

export async function chooseImageForCase(caseId: string): Promise<DocumentImportResult> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 1,
  });
  if (result.canceled) return { status: 'cancelled' };
  const asset = result.assets[0];
  if (!asset || asset.type === 'video') throw new Error('Please choose a valid image.');
  const extension = getImageExtension(asset.fileName, asset.uri, asset.mimeType);
  const displayName = asset.fileName?.trim() || `Image_${Date.now()}${extension}`;
  return saveImportedDocument(caseId, asset.uri, displayName, 'IMAGE', extension);
}

export async function takePhotoForCase(caseId: string): Promise<DocumentImportResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return { status: 'permission-denied' };
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 0.9,
  });
  if (result.canceled) return { status: 'cancelled' };
  const asset = result.assets[0];
  if (!asset) throw new Error('No photo was captured.');
  const extension = getImageExtension(asset.fileName, asset.uri, asset.mimeType);
  const displayName = asset.fileName?.trim() || `Photo_${Date.now()}${extension}`;
  return saveImportedDocument(caseId, asset.uri, displayName, 'IMAGE', extension);
}

export async function updateDocumentDetails(
  documentId: string,
  displayName: string,
  description: string,
): Promise<CaseDocument | null> {
  const current = await getDocumentById(documentId);
  if (!current) return null;
  return updateDocument(documentId, {
    fileName: normalizeDisplayFilename(displayName, current.fileName),
    description: description.trim() || null,
  });
}

export async function deleteDocumentWithFile(
  documentId: string,
): Promise<{ deleted: boolean; fileCleanupFailed: boolean }> {
  const document = await getDocumentById(documentId);
  if (!document) return { deleted: false, fileCleanupFailed: false };
  const deleted = await deleteDocument(documentId);
  if (!deleted) return { deleted: false, fileCleanupFailed: false };

  try {
    deleteStoredFile(document.filePath);
    return { deleted: true, fileCleanupFailed: false };
  } catch (error) {
    console.error('Document metadata was removed, but its local file could not be cleaned up.', error);
    return { deleted: true, fileCleanupFailed: true };
  }
}

async function saveImportedDocument(
  caseId: string,
  sourceUri: string,
  displayName: string,
  fileType: DocumentFileType,
  extension: string,
): Promise<DocumentImportResult> {
  const storedPath = await copyPickedFileToCaseStorage(sourceUri, caseId, extension);
  try {
    const document = await createDocument({
      caseId,
      fileName: normalizeDisplayFilename(displayName, `Document${extension}`),
      filePath: storedPath,
      fileType,
      description: null,
    });
    return { status: 'saved', document };
  } catch (error) {
    try {
      deleteStoredFile(storedPath);
    } catch (cleanupError) {
      console.error('Unable to roll back an imported file after metadata failure.', cleanupError);
    }
    throw error;
  }
}

function getImageExtension(
  fileName: string | null | undefined,
  uri: string,
  mimeType: string | undefined,
): string {
  const mimeExtensions: Record<string, string> = {
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/heic': '.heic',
    'image/heif': '.heif',
    'image/jpeg': '.jpg',
  };
  const extension = getFileExtension(fileName ?? '') || getFileExtension(uri);
  return normalizeFileExtension(mimeExtensions[mimeType ?? ''] ?? extension, '.jpg');
}
