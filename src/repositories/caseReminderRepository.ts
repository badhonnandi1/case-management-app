import { getDatabase } from '../database/database';
import type { CaseReminder } from '../models/CaseReminder';

interface CaseReminderRow {
  case_id: string;
  notification_id: string;
  scheduled_for: string;
  updated_at: string;
}

function mapReminder(row: CaseReminderRow): CaseReminder {
  return {
    caseId: row.case_id,
    notificationId: row.notification_id,
    scheduledFor: row.scheduled_for,
    updatedAt: row.updated_at,
  };
}

export async function getCaseReminder(caseId: string): Promise<CaseReminder | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<CaseReminderRow>(
    `SELECT case_id, notification_id, scheduled_for, updated_at
     FROM case_reminders WHERE case_id = ?`,
    caseId,
  );
  return row ? mapReminder(row) : null;
}

export async function getAllCaseReminders(): Promise<CaseReminder[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<CaseReminderRow>(
    `SELECT case_id, notification_id, scheduled_for, updated_at
     FROM case_reminders ORDER BY scheduled_for ASC`,
  );
  return rows.map(mapReminder);
}

export async function saveCaseReminder(
  caseId: string,
  notificationId: string,
  scheduledFor: string,
): Promise<CaseReminder> {
  const reminder: CaseReminder = {
    caseId: caseId.trim(),
    notificationId: notificationId.trim(),
    scheduledFor,
    updatedAt: new Date().toISOString(),
  };
  if (!reminder.caseId || !reminder.notificationId || !reminder.scheduledFor) {
    throw new Error('Complete reminder metadata is required.');
  }
  const database = await getDatabase();
  await database.runAsync(
    `INSERT INTO case_reminders (case_id, notification_id, scheduled_for, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(case_id) DO UPDATE SET
       notification_id = excluded.notification_id,
       scheduled_for = excluded.scheduled_for,
       updated_at = excluded.updated_at`,
    reminder.caseId,
    reminder.notificationId,
    reminder.scheduledFor,
    reminder.updatedAt,
  );
  return reminder;
}

export async function deleteCaseReminder(caseId: string): Promise<boolean> {
  const database = await getDatabase();
  const result = await database.runAsync('DELETE FROM case_reminders WHERE case_id = ?', caseId);
  return result.changes > 0;
}
