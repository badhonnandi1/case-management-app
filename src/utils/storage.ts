export interface StorageEntry {
  uri: string;
  size: number;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / 1024 ** unitIndex;
  const digits = unitIndex === 0 || amount >= 10 ? 0 : 1;
  return `${amount.toFixed(digits)} ${units[unitIndex]}`;
}

export function findOrphanFiles(
  physicalFiles: readonly StorageEntry[],
  referencedUris: readonly string[],
): StorageEntry[] {
  const referenced = new Set(referencedUris.map(normalizeUri));
  return physicalFiles.filter((file) => !referenced.has(normalizeUri(file.uri)));
}

export function findMissingDocumentUris(
  physicalFiles: readonly StorageEntry[],
  referencedUris: readonly string[],
): string[] {
  const physical = new Set(physicalFiles.map((file) => normalizeUri(file.uri)));
  return referencedUris.filter((uri) => !physical.has(normalizeUri(uri)));
}

function normalizeUri(uri: string): string {
  return decodeURI(uri).replace(/\/+$/, '');
}
