PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS testers (
  id TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  CHECK (length(trim(label)) BETWEEN 1 AND 80),
  CHECK (length(code_hash) = 43)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  tester_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (tester_id) REFERENCES testers(id) ON DELETE CASCADE,
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_sessions_tester ON sessions(tester_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS usage_counters (
  scope TEXT NOT NULL CHECK (scope IN ('tester_minute', 'tester_day', 'global_day')),
  subject_id TEXT NOT NULL,
  bucket TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope, subject_id, bucket)
);

CREATE TABLE IF NOT EXISTS answer_reservations (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  tester_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  minute_bucket TEXT NOT NULL,
  day_bucket TEXT NOT NULL,
  minute_limit INTEGER NOT NULL CHECK (minute_limit > 0),
  tester_day_limit INTEGER NOT NULL CHECK (tester_day_limit > 0),
  global_day_limit INTEGER NOT NULL CHECK (global_day_limit > 0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (tester_id) REFERENCES testers(id) ON DELETE CASCADE,
  UNIQUE (session_id, request_id),
  CHECK (length(fingerprint) = 43)
);

CREATE INDEX IF NOT EXISTS idx_answer_reservations_expiry ON answer_reservations(expires_at);

CREATE TABLE IF NOT EXISTS provider_circuits (
  provider TEXT PRIMARY KEY NOT NULL CHECK (provider IN ('gemini', 'groq')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  open_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
