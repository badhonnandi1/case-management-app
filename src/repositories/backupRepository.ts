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
    await transaction.runAsync('DELETE FROM cases');
    await transaction.runAsync('DELETE FROM settings');

    for (const caseItem of data.cases) {
      await transaction.runAsync(
        `INSERT INTO cases (
          id, case_number, case_type, case_serial, case_year, case_title, party_name,
          opposite_party_name, represented_side, court_name, judge_name, previous_date,
          next_date, previous_order, next_step, status, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        caseItem.id,
        caseItem.caseNumber,
        caseItem.caseType,
        caseItem.caseSerial,
        caseItem.caseYear,
        caseItem.caseTitle,
        caseItem.partyName,
        caseItem.oppositePartyName,
        caseItem.representedSide,
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
          id, case_id, hearing_date, order_text, next_step, next_date, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        history.id,
        history.caseId,
        history.hearingDate,
        history.orderText,
        history.nextStep,
        history.nextDate,
        history.notes,
        history.createdAt,
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

function insertSetting(transaction: TransactionWriter, setting: AppSettings): Promise<unknown> {
  return transaction.runAsync(
    'INSERT INTO settings (id, key, value, updated_at) VALUES (?, ?, ?, ?)',
    setting.id,
    setting.key,
    setting.value,
    setting.updatedAt,
  );
}
