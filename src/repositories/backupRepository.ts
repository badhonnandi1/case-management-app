import { getDatabase } from '../database/database';
import type { AppSettings } from '../models/AppSettings';
import type { BackupData } from '../models/Backup';
import type { CaseDocument } from '../models/CaseDocument';

export async function replaceAllPortableData(
  data: BackupData,
  restoredDocuments: readonly CaseDocument[],
): Promise<void> {
  if (data.documents.length !== restoredDocuments.length) {
    throw new Error('Restored document metadata is incomplete.');
  }

  const database = await getDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    // AI indexes and chats are device-derived data and are intentionally not portable.
    await transaction.runAsync('DELETE FROM ai_threads');
    await transaction.runAsync('DELETE FROM ai_sources');
    await transaction.runAsync('DELETE FROM case_reminders');
    await transaction.runAsync('DELETE FROM documents');
    await transaction.runAsync('DELETE FROM case_history');
    await transaction.runAsync('DELETE FROM case_tasks');
    await transaction.runAsync('DELETE FROM cases');
    await transaction.runAsync('DELETE FROM courts');
    await transaction.runAsync('DELETE FROM settings');

    for (const court of data.courts) {
      await transaction.runAsync(
        `INSERT INTO courts (
          id, full_name, short_code, normalized_full_name, normalized_short_code, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        court.id,
        court.fullName,
        court.shortCode,
        normalizeCourtText(court.fullName),
        normalizeCourtText(court.shortCode),
        court.createdAt,
        court.updatedAt,
      );
    }

    for (const caseItem of data.cases) {
      await transaction.runAsync(
        `INSERT INTO cases (
          id, case_number, case_type, case_serial, case_year, case_title, party_name,
          opposite_party_name, represented_side, represented_role, court_id, court_name, judge_name, previous_date,
          next_date, previous_order, next_step, status, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        caseItem.id,
        caseItem.caseNumber,
        caseItem.caseType,
        caseItem.caseSerial,
        caseItem.caseYear,
        caseItem.caseTitle,
        caseItem.partyName,
        caseItem.oppositePartyName,
        caseItem.representedSide === 'PLAINTIFF' || caseItem.representedSide === 'DEFENDANT'
          ? caseItem.representedSide
          : null,
        caseItem.representedSide,
        caseItem.courtId,
        caseItem.courtName,
        caseItem.judgeName,
        caseItem.previousDate,
        caseItem.nextDate,
        caseItem.previousOrder,
        caseItem.nextStep,
        caseItem.status,
        caseItem.notes,
        caseItem.createdAt,
        caseItem.updatedAt,
      );
    }

    for (const history of data.caseHistory) {
      await transaction.runAsync(
        `INSERT INTO case_history (
          id, case_id, hearing_date, order_text, next_step, next_date, notes,
          payment_status, payment_amount_minor, payment_note, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        history.id,
        history.caseId,
        history.hearingDate,
        history.orderText,
        history.nextStep,
        history.nextDate,
        history.notes,
        history.paymentStatus,
        history.paymentAmountMinor,
        history.paymentNote,
        history.createdAt,
      );
    }

    for (const task of data.caseTasks) {
      await transaction.runAsync(
        `INSERT INTO case_tasks (
          id, case_id, title, note, due_date, is_completed, created_at, completed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        task.id,
        task.caseId,
        task.title,
        task.note,
        task.dueDate,
        task.completed ? 1 : 0,
        task.createdAt,
        task.completedAt,
        task.updatedAt,
      );
    }

    for (const document of restoredDocuments) {
      await transaction.runAsync(
        `INSERT INTO documents (
          id, case_id, file_name, file_path, file_type, description, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        document.id,
        document.caseId,
        document.fileName,
        document.filePath,
        document.fileType,
        document.description,
        document.createdAt,
      );
    }

    for (const setting of data.settings) {
      await insertSetting(transaction, setting);
    }
  });
}

interface TransactionWriter {
  runAsync(source: string, ...params: (string | number | null)[]): Promise<{ changes: number }>;
}

function normalizeCourtText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('bn-BD');
}

function insertSetting(transaction: TransactionWriter, setting: AppSettings): Promise<unknown> {
  return transaction.runAsync(
    'INSERT INTO settings (id, key, value, updated_at) VALUES (?, ?, ?, ?)',
    setting.id,
    setting.key,
    setting.value,
    setting.updatedAt,
  );
}
