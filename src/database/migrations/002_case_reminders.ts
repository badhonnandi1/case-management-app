export const caseRemindersMigration = {
  version: 2,
  name: 'case_reminders',
  statements: [
    `CREATE TABLE IF NOT EXISTS case_reminders (
      case_id TEXT PRIMARY KEY NOT NULL,
      notification_id TEXT NOT NULL UNIQUE,
      scheduled_for TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
    )`,
    'CREATE INDEX IF NOT EXISTS idx_case_reminders_notification_id ON case_reminders(notification_id)',
  ],
} as const;
