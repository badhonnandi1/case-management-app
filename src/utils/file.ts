const SAFE_EXTENSION_PATTERN = /^\.[a-z0-9]{1,10}$/;

export function getFileExtension(value: string): string {
  const cleanValue = value.split(/[?#]/, 1)[0] ?? '';
  const lastSegment = cleanValue.split('/').pop() ?? '';
  const dotIndex = lastSegment.lastIndexOf('.');
  if (dotIndex <= 0) return '';
  const extension = lastSegment.slice(dotIndex).toLowerCase();
  return SAFE_EXTENSION_PATTERN.test(extension) ? extension : '';
}

export function normalizeFileExtension(extension: string, fallback: string): string {
  const normalized = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  return SAFE_EXTENSION_PATTERN.test(normalized) ? normalized : fallback;
}

export function normalizeDisplayFilename(input: string, currentFileName: string): string {
  const expectedExtension = getFileExtension(currentFileName);
  const cleaned = input.replace(/[\\/\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) throw new Error('Document name is required.');

  const providedExtension = getFileExtension(cleaned);
  const baseName = providedExtension ? cleaned.slice(0, -providedExtension.length).trim() : cleaned;
  if (!baseName) throw new Error('Document name is required.');
  return `${baseName}${expectedExtension}`;
}

export function buildCollisionFileName(baseName: string, attempt: number): string {
  if (attempt <= 1) return baseName;
  const extension = getFileExtension(baseName);
  const stem = extension ? baseName.slice(0, -extension.length) : baseName;
  return `${stem}_${attempt}${extension}`;
}

export function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!sanitized) throw new Error('A valid storage identifier is required.');
  return sanitized;
}
