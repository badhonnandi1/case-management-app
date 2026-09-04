export const offlineCaseToolsMigration = {
  version: 5,
  name: 'offline_courts_payments_and_tasks',
  statements: [
    `CREATE TABLE courts (
      id TEXT PRIMARY KEY NOT NULL,
      full_name TEXT NOT NULL,
      short_code TEXT NOT NULL,
      normalized_full_name TEXT NOT NULL UNIQUE,
      normalized_short_code TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (length(trim(full_name)) > 0),
      CHECK (length(trim(short_code)) > 0)
    )`,
    'CREATE INDEX idx_courts_full_name ON courts(full_name COLLATE NOCASE)',
    'ALTER TABLE cases ADD COLUMN court_id TEXT REFERENCES courts(id) ON DELETE RESTRICT',
    'CREATE INDEX idx_cases_court_id ON cases(court_id)',
    // Migration 3's represented_side CHECK only permits the two original roles.
    // A new column expands the stable identifiers without rebuilding shipped data.
    'ALTER TABLE cases ADD COLUMN represented_role TEXT',
    "ALTER TABLE case_history ADD COLUMN payment_status TEXT CHECK (payment_status IS NULL OR payment_status IN ('PAID', 'UNPAID'))",
    'ALTER TABLE case_history ADD COLUMN payment_amount_minor INTEGER CHECK (payment_amount_minor IS NULL OR payment_amount_minor >= 0)',
    'ALTER TABLE case_history ADD COLUMN payment_note TEXT',
    `CREATE TABLE case_tasks (
      id TEXT PRIMARY KEY NOT NULL,
      case_id TEXT NOT NULL,
      title TEXT NOT NULL,
      note TEXT,
      due_date TEXT,
      is_completed INTEGER NOT NULL DEFAULT 0 CHECK (is_completed IN (0, 1)),
      created_at TEXT NOT NULL,
      completed_at TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
      CHECK (length(trim(title)) > 0),
      CHECK ((is_completed = 0 AND completed_at IS NULL) OR (is_completed = 1 AND completed_at IS NOT NULL))
    )`,
    'CREATE INDEX idx_case_tasks_case_status_due ON case_tasks(case_id, is_completed, due_date, created_at)',
  ],
} as const;
