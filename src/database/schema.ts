export const INITIAL_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY NOT NULL,
    case_number TEXT NOT NULL,
    case_title TEXT NOT NULL,
    party_name TEXT NOT NULL,
    opposite_party_name TEXT NOT NULL,
    court_name TEXT NOT NULL,
    judge_name TEXT,
    previous_date TEXT,
    next_date TEXT,
    previous_order TEXT,
    next_step TEXT,
    status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'PENDING', 'CLOSED')),
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS case_history (
    id TEXT PRIMARY KEY NOT NULL,
    case_id TEXT NOT NULL,
    hearing_date TEXT NOT NULL,
    order_text TEXT,
    next_step TEXT,
    next_date TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY NOT NULL,
    case_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_type TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY NOT NULL,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS case_reminders (
    case_id TEXT PRIMARY KEY NOT NULL,
    notification_id TEXT NOT NULL UNIQUE,
    scheduled_for TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
  )`,
  'CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status)',
  'CREATE INDEX IF NOT EXISTS idx_cases_next_date ON cases(next_date)',
  'CREATE INDEX IF NOT EXISTS idx_cases_updated_at ON cases(updated_at)',
  'CREATE INDEX IF NOT EXISTS idx_case_history_case_id ON case_history(case_id)',
  'CREATE INDEX IF NOT EXISTS idx_documents_case_id ON documents(case_id)',
  'CREATE INDEX IF NOT EXISTS idx_case_reminders_notification_id ON case_reminders(notification_id)',
] as const;
