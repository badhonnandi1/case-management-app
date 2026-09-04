import { File, FileMode } from 'expo-file-system';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export { sha256Hex } from './sha256';

const HASH_CHUNK_SIZE = 256 * 1024;

export interface FileFingerprint {
  hash: string;
  size: number;
  modificationTime: number | null;
}

export function getFileFingerprint(uri: string): FileFingerprint {
  const file = new File(uri);
  if (!file.exists) throw new Error('The document file is missing from local storage.');
  const handle = file.open(FileMode.ReadOnly);
  const hash = sha256.create();
  try {
    const size = handle.size ?? file.size;
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error('The document file size is unavailable.');
    }
    let remaining = size;
    while (remaining > 0) {
      const chunk = handle.readBytes(Math.min(HASH_CHUNK_SIZE, remaining));
      if (chunk.byteLength === 0) throw new Error('The document file ended unexpectedly.');
      hash.update(chunk);
      remaining -= chunk.byteLength;
    }
    return {
      hash: bytesToHex(hash.digest()),
      size,
      modificationTime: file.modificationTime,
    };
  } finally {
    handle.close();
  }
}

export async function getFileFingerprintAsync(
  uri: string,
  signal?: AbortSignal,
): Promise<FileFingerprint> {
  const file = new File(uri);
  if (!file.exists) throw new Error('The document file is missing from local storage.');
  const handle = file.open(FileMode.ReadOnly);
  const hash = sha256.create();
  try {
    const size = handle.size ?? file.size;
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error('The document file size is unavailable.');
    }
    let remaining = size;
    while (remaining > 0) {
      if (signal?.aborted) throw new Error('Indexing cancelled.');
      const chunk = handle.readBytes(Math.min(HASH_CHUNK_SIZE, remaining));
      if (chunk.byteLength === 0) throw new Error('The document file ended unexpectedly.');
      hash.update(chunk);
      remaining -= chunk.byteLength;
      // FileHandle reads are synchronous. Yield between bounded chunks so long
      // documents do not monopolize the React Native JavaScript thread.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (signal?.aborted) throw new Error('Indexing cancelled.');
    return {
      hash: bytesToHex(hash.digest()),
      size,
      modificationTime: file.modificationTime,
    };
  } finally {
    handle.close();
  }
}
