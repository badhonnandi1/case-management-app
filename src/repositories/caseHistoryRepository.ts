import { getDatabase } from '../database/database';
import type {
  CaseHistory,
  CreateCaseHistoryInput,
  RecordHearingUpdateInput,
} from '../models/CaseHistory';
import { isValidDateOnly } from '../utils/date';
import { createId } from '../utils/id';

interface CaseHistoryRow {
  id: string;
  case_id: string;
  hearing_date: string;
  order_text: string | null;
  next_step: string | null;
  next_date: string | null;
  notes: string | null;
  payment_status: CaseHistory['paymentStatus'];
  payment_amount_minor: number | null;
  payment_note: string | null;
  created_at: string;
}

interface CaseTimestampRow {
  updated_at: string;
}

function mapCaseHistory(row: CaseHistoryRow): CaseHistory {
  return {
    id: row.id,
    caseId: row.case_id,
    hearingDate: row.hearing_date,
    orderText: row.order_text,
    nextStep: row.next_step,
    nextDate: row.next_date,
    notes: row.notes,
    paymentStatus: row.payment_status,
    paymentAmountMinor: row.payment_amount_minor,
    paymentNote: row.payment_note,
    createdAt: row.created_at,
  };
}

export async function createCaseHistory(
  input: CreateCaseHistoryInput,
): Promise<CaseHistory> {
  const database = await getDatabase();
  const entry = normalizeHistoryInput(input);

  await database.runAsync(
    `INSERT INTO case_history (
      id, case_id, hearing_date, order_text, next_step, next_date, notes,
      payment_status, payment_amount_minor, payment_note, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    entry.id,
    entry.caseId,
    entry.hearingDate,
    entry.orderText,
    entry.nextStep,
    entry.nextDate,
    entry.notes,
    entry.paymentStatus,
    entry.paymentAmountMinor,
    entry.paymentNote,
    entry.createdAt,
  );

  return entry;
}

export async function getHistoryByCaseId(caseId: string): Promise<CaseHistory[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<CaseHistoryRow>(
    `SELECT id, case_id, hearing_date, order_text, next_step, next_date, notes,
       payment_status, payment_amount_minor, payment_note, created_at
     FROM case_history WHERE case_id = ? ORDER BY hearing_date DESC, created_at DESC`,
    caseId,
  );
  return rows.map(mapCaseHistory);
}

export async function getAllCaseHistory(): Promise<CaseHistory[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<CaseHistoryRow>(
    `SELECT id, case_id, hearing_date, order_text, next_step, next_date, notes,
       payment_status, payment_amount_minor, payment_note, created_at
     FROM case_history ORDER BY case_id ASC, hearing_date ASC, created_at ASC, id ASC`,
  );
  return rows.map(mapCaseHistory);
}

export const getCaseHistory = getHistoryByCaseId;
export const createHistoryEntry = createCaseHistory;

export async function getLatestHistoryForCase(caseId: string): Promise<CaseHistory | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<CaseHistoryRow>(
    `SELECT id, case_id, hearing_date, order_text, next_step, next_date, notes,
       payment_status, payment_amount_minor, payment_note, created_at
     FROM case_history WHERE case_id = ?
     ORDER BY hearing_date DESC, created_at DESC LIMIT 1`,
    caseId,
  );
  return row ? mapCaseHistory(row) : null;
}

export async function getHistoryCount(caseId: string): Promise<number> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM case_history WHERE case_id = ?',
    caseId,
  );
  return row?.count ?? 0;
}

export async function recordHearingUpdate(
  input: RecordHearingUpdateInput,
): Promise<CaseHistory> {
  const database = await getDatabase();
  const entry = normalizeHistoryInput(input);

  await database.withExclusiveTransactionAsync(async (transaction) => {
    const caseRow = await transaction.getFirstAsync<CaseTimestampRow>(
      'SELECT updated_at FROM cases WHERE id = ?',
      entry.caseId,
    );
    if (!caseRow) {
      throw new Error('The case no longer exists.');
    }

    await transaction.runAsync(
      `INSERT INTO case_history (
        id, case_id, hearing_date, order_text, next_step, next_date, notes,
        payment_status, payment_amount_minor, payment_note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.id,
      entry.caseId,
      entry.hearingDate,
      entry.orderText,
      entry.nextStep,
      entry.nextDate,
      entry.notes,
      entry.paymentStatus,
      entry.paymentAmountMinor,
      entry.paymentNote,
      entry.createdAt,
    );

    const result = await transaction.runAsync(
      `UPDATE cases SET
        previous_date = ?, previous_order = ?, next_date = ?, next_step = ?, updated_at = ?
       WHERE id = ?`,
      entry.hearingDate,
      entry.orderText,
      entry.nextDate,
      entry.nextStep,
      createNextTimestamp(caseRow.updated_at),
      entry.caseId,
    );
    if (result.changes !== 1) {
      throw new Error('The case hearing snapshot could not be updated.');
    }
  });

  return entry;
}

export async function deleteCaseHistory(id: string): Promise<boolean> {
  const database = await getDatabase();
  const result = await database.runAsync('DELETE FROM case_history WHERE id = ?', id);
  return result.changes > 0;
}

function normalizeHistoryInput(input: CreateCaseHistoryInput): CaseHistory {
  const caseId = input.caseId.trim();
  const hearingDate = input.hearingDate.trim();
  const optionalText = (value: string | null | undefined) => value?.trim() || null;
  const nextDate = optionalText(input.nextDate);
  const paymentStatus = input.paymentStatus ?? null;
  const paymentAmountMinor = input.paymentAmountMinor ?? null;

  if (!caseId) {
    throw new Error('A case is required.');
  }
  if (!isValidDateOnly(hearingDate)) {
    throw new Error('Hearing date must use YYYY-MM-DD format.');
  }
  if (nextDate && !isValidDateOnly(nextDate)) {
    throw new Error('Next hearing date must use YYYY-MM-DD format.');
  }
  if (paymentStatus !== null && paymentStatus !== 'PAID' && paymentStatus !== 'UNPAID') {
    throw new Error('Invalid payment status.');
  }
  if (paymentAmountMinor !== null && (!Number.isSafeInteger(paymentAmountMinor) || paymentAmountMinor < 0)) {
    throw new Error('Payment amount must be a non-negative amount.');
  }
  if (paymentStatus !== 'PAID' && paymentAmountMinor !== null) {
    throw new Error('A payment amount requires Paid status.');
  }

  return {
    id: createId(),
    caseId,
    hearingDate,
    orderText: optionalText(input.orderText),
    nextStep: optionalText(input.nextStep),
    nextDate,
    notes: optionalText(input.notes),
    paymentStatus,
    paymentAmountMinor,
    paymentNote: paymentStatus ? optionalText(input.paymentNote) : null,
    createdAt: new Date().toISOString(),
  };
}

function createNextTimestamp(previousTimestamp: string): string {
  const now = Date.now();
  const previousTime = Date.parse(previousTimestamp);
  const nextTime = Number.isNaN(previousTime) ? now : Math.max(now, previousTime + 1);
  return new Date(nextTime).toISOString();
}
