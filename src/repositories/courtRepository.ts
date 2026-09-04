import { getDatabase } from '../database/database';
import type { Court, CreateCourtInput, UpdateCourtInput } from '../models/Court';
import { createId } from '../utils/id';

interface CourtRow {
  id: string;
  full_name: string;
  short_code: string;
  created_at: string;
  updated_at: string;
}

export class CourtDuplicateError extends Error {
  constructor() {
    super('A court with the same full name or short code already exists.');
    this.name = 'CourtDuplicateError';
  }
}

export class CourtInUseError extends Error {
  constructor(public readonly caseCount: number) {
    super(`This court is used by ${caseCount} case${caseCount === 1 ? '' : 's'}.`);
    this.name = 'CourtInUseError';
  }
}

export async function getCourts(search = ''): Promise<Court[]> {
  const database = await getDatabase();
  const normalizedSearch = normalizeCourtText(search);
  const rows = normalizedSearch
    ? await database.getAllAsync<CourtRow>(
      `SELECT id, full_name, short_code, created_at, updated_at FROM courts
       WHERE normalized_full_name LIKE ? ESCAPE char(92)
          OR normalized_short_code LIKE ? ESCAPE char(92)
       ORDER BY full_name COLLATE NOCASE ASC`,
      `%${escapeLike(normalizedSearch)}%`,
      `%${escapeLike(normalizedSearch)}%`,
    )
    : await database.getAllAsync<CourtRow>(
      `SELECT id, full_name, short_code, created_at, updated_at FROM courts
       ORDER BY full_name COLLATE NOCASE ASC`,
    );
  return rows.map(mapCourt);
}

export async function getCourtById(id: string): Promise<Court | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<CourtRow>(
    'SELECT id, full_name, short_code, created_at, updated_at FROM courts WHERE id = ?',
    id,
  );
  return row ? mapCourt(row) : null;
}

export async function createCourt(input: CreateCourtInput): Promise<Court> {
  const database = await getDatabase();
  const normalized = normalizeCourtInput(input);
  const id = createId();
  const timestamp = new Date().toISOString();
  await assertCourtUnique(normalized.fullNameKey, normalized.shortCodeKey);
  try {
    await database.runAsync(
      `INSERT INTO courts (
        id, full_name, short_code, normalized_full_name, normalized_short_code, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      normalized.fullName,
      normalized.shortCode,
      normalized.fullNameKey,
      normalized.shortCodeKey,
      timestamp,
      timestamp,
    );
  } catch (error) {
    if (isUniqueConstraint(error)) throw new CourtDuplicateError();
    throw error;
  }
  const court = await getCourtById(id);
  if (!court) throw new Error('The court was saved but could not be retrieved.');
  return court;
}

export async function updateCourt(id: string, input: UpdateCourtInput): Promise<Court | null> {
  const database = await getDatabase();
  const normalized = normalizeCourtInput(input);
  await assertCourtUnique(normalized.fullNameKey, normalized.shortCodeKey, id);
  try {
    const result = await database.runAsync(
      `UPDATE courts SET full_name = ?, short_code = ?, normalized_full_name = ?,
        normalized_short_code = ?, updated_at = ? WHERE id = ?`,
      normalized.fullName,
      normalized.shortCode,
      normalized.fullNameKey,
      normalized.shortCodeKey,
      new Date().toISOString(),
      id,
    );
    if (result.changes === 0) return null;
  } catch (error) {
    if (isUniqueConstraint(error)) throw new CourtDuplicateError();
    throw error;
  }
  return getCourtById(id);
}

export async function getCourtUsageCount(id: string): Promise<number> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM cases WHERE court_id = ?',
    id,
  );
  return row?.count ?? 0;
}

export async function deleteCourt(id: string): Promise<boolean> {
  const database = await getDatabase();
  let deleted = false;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const row = await transaction.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM cases WHERE court_id = ?',
      id,
    );
    const count = row?.count ?? 0;
    if (count > 0) throw new CourtInUseError(count);
    const result = await transaction.runAsync('DELETE FROM courts WHERE id = ?', id);
    deleted = result.changes > 0;
  });
  return deleted;
}

export function courtDisplayName(court: Pick<Court, 'fullName' | 'shortCode'>): string {
  return `${court.fullName} (${court.shortCode})`;
}

export function normalizeCourtText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('bn-BD');
}

function normalizeCourtInput(input: CreateCourtInput) {
  const fullName = input.fullName.trim().replace(/\s+/g, ' ');
  const shortCode = input.shortCode.trim().replace(/\s+/g, ' ');
  if (!fullName) throw new Error('Full court name is required.');
  if (!shortCode) throw new Error('Court short code is required.');
  if (fullName.length > 250 || shortCode.length > 60) throw new Error('Court name or short code is too long.');
  return {
    fullName,
    shortCode,
    fullNameKey: normalizeCourtText(fullName),
    shortCodeKey: normalizeCourtText(shortCode),
  };
}

async function assertCourtUnique(fullNameKey: string, shortCodeKey: string, excludingId?: string) {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ id: string }>(
    `SELECT id FROM courts
     WHERE (normalized_full_name = ? OR normalized_short_code = ?)
       AND (? IS NULL OR id != ?) LIMIT 1`,
    fullNameKey,
    shortCodeKey,
    excludingId ?? null,
    excludingId ?? null,
  );
  if (row) throw new CourtDuplicateError();
}

function mapCourt(row: CourtRow): Court {
  return {
    id: row.id,
    fullName: row.full_name,
    shortCode: row.short_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && /unique constraint/i.test(error.message);
}
