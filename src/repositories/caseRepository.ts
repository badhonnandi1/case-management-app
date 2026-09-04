import {
  REPRESENTED_SIDE_OPTIONS,
  type Case,
  type CaseCounts,
  type CaseQueryOptions,
  type CaseStatus,
  type CreateCaseInput,
  type UpdateCaseInput,
} from '../models/Case';
import { getDatabase } from '../database/database';
import { isValidDateOnly, toLocalDateString } from '../utils/date';
import { createId } from '../utils/id';

interface CaseRow {
  id: string;
  case_number: string;
  case_type: string | null;
  case_serial: string | null;
  case_year: string | null;
  case_title: string;
  party_name: string;
  opposite_party_name: string;
  represented_side: Case['representedSide'];
  represented_role: Case['representedSide'];
  court_id: string | null;
  court_name: string;
  court_short_code: string | null;
  judge_name: string | null;
  previous_date: string | null;
  next_date: string | null;
  previous_order: string | null;
  next_step: string | null;
  status: Case['status'];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface CountRow {
  today_count: number;
  upcoming_count: number;
  active_count: number;
  total_count: number;
}

interface NormalizedCaseInput {
  caseNumber: string;
  caseType: string | null;
  caseSerial: string | null;
  caseYear: string | null;
  caseTitle: string;
  partyName: string;
  oppositePartyName: string;
  representedSide: Case['representedSide'];
  courtId: string | null;
  courtName: string;
  judgeName: string | null;
  previousDate: string | null;
  nextDate: string | null;
  previousOrder: string | null;
  nextStep: string | null;
  status: CaseStatus;
  notes: string | null;
  previousPaymentStatus: NonNullable<CreateCaseInput['previousPaymentStatus']> | null;
  previousPaymentAmountMinor: number | null;
  previousPaymentNote: string | null;
}

const CASE_COLUMNS = `
  cases.id, case_number, case_type, case_serial, case_year, case_title, party_name,
  opposite_party_name, represented_side, represented_role, court_id,
  COALESCE((SELECT full_name FROM courts WHERE id = cases.court_id), court_name) AS court_name,
  (SELECT short_code FROM courts WHERE id = cases.court_id) AS court_short_code,
  judge_name, previous_date, next_date, previous_order, next_step, status,
  notes, cases.created_at, cases.updated_at
`;

function mapCase(row: CaseRow): Case {
  return {
    id: row.id,
    caseNumber: row.case_number,
    caseType: row.case_type,
    caseSerial: row.case_serial,
    caseYear: row.case_year,
    caseTitle: row.case_title,
    partyName: row.party_name,
    oppositePartyName: row.opposite_party_name,
    representedSide: row.represented_role ?? row.represented_side,
    courtId: row.court_id,
    courtName: row.court_name,
    courtShortCode: row.court_short_code,
    judgeName: row.judge_name,
    previousDate: row.previous_date,
    nextDate: row.next_date,
    previousOrder: row.previous_order,
    nextStep: row.next_step,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function queryCases(sql: string, ...parameters: (string | number)[]): Promise<Case[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<CaseRow>(sql, ...parameters);
  return rows.map(mapCase);
}

export async function createCase(input: CreateCaseInput): Promise<Case> {
  const database = await getDatabase();
  const normalizedInput = normalizeCaseInput(input);
  const id = createId();
  const timestamp = new Date().toISOString();

  await database.withExclusiveTransactionAsync(async (transaction) => {
    const courtName = await resolveCourtName(transaction, normalizedInput.courtId, normalizedInput.courtName);
    await transaction.runAsync(
      `INSERT INTO cases (
        id, case_number, case_type, case_serial, case_year, case_title, party_name,
        opposite_party_name, represented_side, represented_role, court_id, court_name,
        judge_name, previous_date, next_date, previous_order, next_step, status, notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      normalizedInput.caseNumber,
      normalizedInput.caseType,
      normalizedInput.caseSerial,
      normalizedInput.caseYear,
      normalizedInput.caseTitle,
      normalizedInput.partyName,
      normalizedInput.oppositePartyName,
      legacyRepresentedSide(normalizedInput.representedSide),
      normalizedInput.representedSide,
      normalizedInput.courtId,
      courtName,
      normalizedInput.judgeName,
      normalizedInput.previousDate,
      normalizedInput.nextDate,
      normalizedInput.previousOrder,
      normalizedInput.nextStep,
      normalizedInput.status,
      normalizedInput.notes,
      timestamp,
      timestamp,
    );

    if (normalizedInput.previousDate) {
      await transaction.runAsync(
        `INSERT INTO case_history (
          id, case_id, hearing_date, order_text, next_step, next_date, notes,
          payment_status, payment_amount_minor, payment_note, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        createId(),
        id,
        normalizedInput.previousDate,
        normalizedInput.previousOrder,
        normalizedInput.nextStep,
        normalizedInput.nextDate,
        normalizedInput.previousPaymentStatus,
        normalizedInput.previousPaymentAmountMinor,
        normalizedInput.previousPaymentNote,
        timestamp,
      );
    }
  });

  const createdCase = await getCaseById(id);
  if (!createdCase) {
    throw new Error('The case was saved but could not be retrieved.');
  }

  return createdCase;
}

export function getAllCases(): Promise<Case[]> {
  return getCases();
}

export function getCasesByIds(ids: readonly string[]): Promise<Case[]> {
  const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) return Promise.resolve([]);
  const placeholders = uniqueIds.map(() => '?').join(', ');
  return queryCases(
    `SELECT ${CASE_COLUMNS} FROM cases WHERE id IN (${placeholders})
     ORDER BY case_title COLLATE NOCASE ASC, case_number COLLATE NOCASE ASC`,
    ...uniqueIds,
  );
}

export function getCases(options: CaseQueryOptions = {}): Promise<Case[]> {
  const filter = options.filter ?? 'ALL';
  const sort = options.sort ?? 'NEXT_HEARING';
  const today = options.today ?? toLocalDateString();
  const whereClauses: string[] = [];
  const parameters: (string | number)[] = [];
  const normalizedSearch = options.search?.trim();

  if (normalizedSearch) {
    const escapedSearch = normalizedSearch.replace(/[\\%_]/g, '\\$&');
    const searchTerm = `%${escapedSearch}%`;
    whereClauses.push(`(
      case_title LIKE ? ESCAPE char(92) COLLATE NOCASE
      OR case_number LIKE ? ESCAPE char(92) COLLATE NOCASE
      OR party_name LIKE ? ESCAPE char(92) COLLATE NOCASE
      OR opposite_party_name LIKE ? ESCAPE char(92) COLLATE NOCASE
      OR court_name LIKE ? ESCAPE char(92) COLLATE NOCASE
      OR EXISTS (
        SELECT 1 FROM courts
        WHERE courts.id = cases.court_id
          AND courts.short_code LIKE ? ESCAPE char(92) COLLATE NOCASE
      )
    )`);
    parameters.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
  }

  if (filter === 'ACTIVE' || filter === 'PENDING' || filter === 'CLOSED') {
    whereClauses.push('status = ?');
    parameters.push(filter);
  } else if (filter === 'TODAY') {
    whereClauses.push('next_date = ?');
    parameters.push(today);
  } else if (filter === 'UPCOMING') {
    whereClauses.push('next_date > ?');
    parameters.push(today);
  }

  let orderBy: string;
  if (sort === 'RECENTLY_UPDATED') {
    orderBy = 'updated_at DESC, case_title COLLATE NOCASE ASC';
  } else if (sort === 'TITLE_ASC') {
    orderBy = 'case_title COLLATE NOCASE ASC, case_number COLLATE NOCASE ASC';
  } else {
    orderBy = `CASE
      WHEN next_date >= ? THEN 0
      WHEN next_date IS NULL THEN 2
      ELSE 1
    END, next_date ASC, case_title COLLATE NOCASE ASC`;
    parameters.push(today);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  return queryCases(
    `SELECT ${CASE_COLUMNS} FROM cases ${whereSql} ORDER BY ${orderBy}`,
    ...parameters,
  );
}

export async function getCaseById(id: string): Promise<Case | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<CaseRow>(
    `SELECT ${CASE_COLUMNS} FROM cases WHERE id = ?`,
    id,
  );
  return row ? mapCase(row) : null;
}

export async function updateCase(id: string, input: UpdateCaseInput): Promise<Case | null> {
  const existingCase = await getCaseById(id);
  if (!existingCase) {
    return null;
  }

  const mergedCase: CreateCaseInput = {
    caseNumber: input.caseNumber ?? existingCase.caseNumber,
    caseType: input.caseType === undefined ? existingCase.caseType : input.caseType,
    caseSerial: input.caseSerial === undefined ? existingCase.caseSerial : input.caseSerial,
    caseYear: input.caseYear === undefined ? existingCase.caseYear : input.caseYear,
    caseTitle: input.caseTitle ?? existingCase.caseTitle,
    partyName: input.partyName ?? existingCase.partyName,
    oppositePartyName: input.oppositePartyName ?? existingCase.oppositePartyName,
    representedSide: input.representedSide === undefined ? existingCase.representedSide : input.representedSide,
    courtId: input.courtId === undefined ? existingCase.courtId : input.courtId,
    courtName: input.courtName ?? existingCase.courtName,
    judgeName: input.judgeName === undefined ? existingCase.judgeName : input.judgeName,
    previousDate:
      input.previousDate === undefined ? existingCase.previousDate : input.previousDate,
    nextDate: input.nextDate === undefined ? existingCase.nextDate : input.nextDate,
    previousOrder:
      input.previousOrder === undefined ? existingCase.previousOrder : input.previousOrder,
    nextStep: input.nextStep === undefined ? existingCase.nextStep : input.nextStep,
    status: input.status ?? existingCase.status,
    notes: input.notes === undefined ? existingCase.notes : input.notes,
  };
  const updatedCase = normalizeCaseInput(mergedCase);
  const database = await getDatabase();

  await database.withExclusiveTransactionAsync(async (transaction) => {
    const courtName = await resolveCourtName(transaction, updatedCase.courtId, updatedCase.courtName);
    await transaction.runAsync(
      `UPDATE cases SET
        case_number = ?, case_type = ?, case_serial = ?, case_year = ?, case_title = ?,
        party_name = ?, opposite_party_name = ?, represented_side = ?, represented_role = ?,
        court_id = ?, court_name = ?, judge_name = ?, previous_date = ?, next_date = ?,
        previous_order = ?, next_step = ?, status = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
      updatedCase.caseNumber,
      updatedCase.caseType,
      updatedCase.caseSerial,
      updatedCase.caseYear,
      updatedCase.caseTitle,
      updatedCase.partyName,
      updatedCase.oppositePartyName,
      legacyRepresentedSide(updatedCase.representedSide),
      updatedCase.representedSide,
      updatedCase.courtId,
      courtName,
      updatedCase.judgeName,
      updatedCase.previousDate,
      updatedCase.nextDate,
      updatedCase.previousOrder,
      updatedCase.nextStep,
      updatedCase.status,
      updatedCase.notes,
      createNextTimestamp(existingCase.updatedAt),
      id,
    );
  });

  return getCaseById(id);
}

export async function deleteCase(id: string): Promise<boolean> {
  const database = await getDatabase();
  const result = await database.runAsync('DELETE FROM cases WHERE id = ?', id);
  return result.changes > 0;
}

export function getActiveCases(): Promise<Case[]> {
  return queryCases(
    `SELECT ${CASE_COLUMNS} FROM cases WHERE status = 'ACTIVE'
     ORDER BY CASE WHEN next_date IS NULL THEN 1 ELSE 0 END, next_date ASC`,
  );
}

export function getCasesByStatus(status: CaseStatus): Promise<Case[]> {
  return getCases({ filter: status });
}

export function getUpcomingCases(limit = 3, fromDate = toLocalDateString()): Promise<Case[]> {
  return queryCases(
    `SELECT ${CASE_COLUMNS} FROM cases
     WHERE next_date >= ? AND status != 'CLOSED'
     ORDER BY next_date ASC LIMIT ?`,
    fromDate,
    limit,
  );
}

export function getTodayCases(date = toLocalDateString()): Promise<Case[]> {
  return queryCases(
    `SELECT ${CASE_COLUMNS} FROM cases
     WHERE next_date = ? AND status != 'CLOSED' ORDER BY case_title ASC`,
    date,
  );
}

export function getCasesByHearingDate(date: string): Promise<Case[]> {
  if (!isValidDateOnly(date)) {
    return Promise.reject(new Error('Hearing date must use YYYY-MM-DD format.'));
  }

  return queryCases(
    `SELECT ${CASE_COLUMNS} FROM cases
     WHERE next_date = ? ORDER BY court_name COLLATE NOCASE ASC, case_title COLLATE NOCASE ASC`,
    date,
  );
}

export function getCasesBetweenDates(startDate: string, endDate: string): Promise<Case[]> {
  if (!isValidDateOnly(startDate) || !isValidDateOnly(endDate) || startDate > endDate) {
    return Promise.reject(new Error('A valid hearing date range is required.'));
  }

  return queryCases(
    `SELECT ${CASE_COLUMNS} FROM cases
     WHERE next_date >= ? AND next_date <= ?
     ORDER BY next_date ASC, court_name COLLATE NOCASE ASC, case_title COLLATE NOCASE ASC`,
    startDate,
    endDate,
  );
}

export function getRecentlyUpdatedCases(limit = 3): Promise<Case[]> {
  return queryCases(
    `SELECT ${CASE_COLUMNS} FROM cases ORDER BY updated_at DESC LIMIT ?`,
    limit,
  );
}

export function searchCases(query: string): Promise<Case[]> {
  return getCases({ search: query });
}

export async function getTotalCaseCount(): Promise<number> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM cases',
  );
  return row?.count ?? 0;
}

export async function getActiveCaseCount(): Promise<number> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM cases WHERE status = 'ACTIVE'",
  );
  return row?.count ?? 0;
}

export async function getCaseCounts(date = toLocalDateString()): Promise<CaseCounts> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<CountRow>(
    `SELECT
      SUM(CASE WHEN next_date = ? AND status != 'CLOSED' THEN 1 ELSE 0 END) AS today_count,
      SUM(CASE WHEN next_date > ? AND status != 'CLOSED' THEN 1 ELSE 0 END) AS upcoming_count,
      SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_count,
      COUNT(*) AS total_count
     FROM cases`,
    date,
    date,
  );

  return {
    today: row?.today_count ?? 0,
    upcoming: row?.upcoming_count ?? 0,
    active: row?.active_count ?? 0,
    total: row?.total_count ?? 0,
  };
}

function normalizeCaseInput(input: CreateCaseInput): NormalizedCaseInput {
  const requiredText = (value: string, fieldName: string) => {
    const normalized = value.trim();
    if (!normalized) {
      throw new Error(`${fieldName} is required.`);
    }
    return normalized;
  };
  const optionalText = (value: string | null | undefined) => value?.trim() || null;
  const previousDate = optionalText(input.previousDate);
  const nextDate = optionalText(input.nextDate);

  if (previousDate && !isValidDateOnly(previousDate)) {
    throw new Error('Previous date must use YYYY-MM-DD format.');
  }
  if (nextDate && !isValidDateOnly(nextDate)) {
    throw new Error('Next date must use YYYY-MM-DD format.');
  }
  if (input.status !== 'ACTIVE' && input.status !== 'PENDING' && input.status !== 'CLOSED') {
    throw new Error('Invalid case status.');
  }
  if (input.representedSide && !REPRESENTED_SIDE_OPTIONS.some((option) => option.value === input.representedSide)) {
    throw new Error('Invalid represented side.');
  }
  const paymentStatus = input.previousPaymentStatus ?? null;
  const paymentAmountMinor = input.previousPaymentAmountMinor ?? null;
  if (paymentStatus !== null && paymentStatus !== 'PAID' && paymentStatus !== 'UNPAID') {
    throw new Error('Invalid payment status.');
  }
  if (paymentAmountMinor !== null && (!Number.isSafeInteger(paymentAmountMinor) || paymentAmountMinor < 0)) {
    throw new Error('Invalid payment amount.');
  }
  if (paymentStatus !== 'PAID' && paymentAmountMinor !== null) {
    throw new Error('A payment amount requires Paid status.');
  }

  return {
    caseNumber: requiredText(input.caseNumber, 'Case number'),
    caseType: optionalText(input.caseType),
    caseSerial: optionalText(input.caseSerial),
    caseYear: optionalText(input.caseYear),
    caseTitle: requiredText(input.caseTitle, 'Case title'),
    partyName: requiredText(input.partyName, 'Party name'),
    oppositePartyName: input.oppositePartyName.trim(),
    representedSide: input.representedSide ?? null,
    courtId: optionalText(input.courtId),
    courtName: requiredText(input.courtName, 'Court name'),
    judgeName: optionalText(input.judgeName),
    previousDate,
    nextDate,
    previousOrder: optionalText(input.previousOrder),
    nextStep: optionalText(input.nextStep),
    status: input.status,
    notes: optionalText(input.notes),
    previousPaymentStatus: paymentStatus,
    previousPaymentAmountMinor: paymentAmountMinor,
    previousPaymentNote: paymentStatus ? optionalText(input.previousPaymentNote) : null,
  };
}

interface CourtReader {
  getFirstAsync<T>(source: string, ...params: (string | null)[]): Promise<T | null>;
}

async function resolveCourtName(
  reader: CourtReader,
  courtId: string | null,
  legacyCourtName: string,
): Promise<string> {
  if (!courtId) return legacyCourtName;
  const row = await reader.getFirstAsync<{ full_name: string }>(
    'SELECT full_name FROM courts WHERE id = ?',
    courtId,
  );
  if (!row) throw new Error('The selected court no longer exists.');
  return row.full_name;
}

function legacyRepresentedSide(side: Case['representedSide']): 'PLAINTIFF' | 'DEFENDANT' | null {
  return side === 'PLAINTIFF' || side === 'DEFENDANT' ? side : null;
}

function createNextTimestamp(previousTimestamp: string): string {
  const now = Date.now();
  const previousTime = Date.parse(previousTimestamp);
  const nextTime = Number.isNaN(previousTime) ? now : Math.max(now, previousTime + 1);
  return new Date(nextTime).toISOString();
}
