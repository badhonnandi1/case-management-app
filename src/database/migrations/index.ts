import type { SQLiteDatabase } from 'expo-sqlite';

import { initialMigration } from './001_initial';
import { caseRemindersMigration } from './002_case_reminders';
import { caseNumberAndSideMigration } from './003_case_number_and_side';
import { aiAssistantMigration } from './004_ai_assistant';
import { offlineCaseToolsMigration } from './005_offline_case_tools';

interface Migration {
  version: number;
  name: string;
  statements: readonly string[];
}

const migrations: readonly Migration[] = [
  initialMigration,
  caseRemindersMigration,
  caseNumberAndSideMigration,
  aiAssistantMigration,
  offlineCaseToolsMigration,
];

export const LATEST_SCHEMA_VERSION = migrations.at(-1)?.version ?? 0;

export async function runMigrations(
  database: SQLiteDatabase,
  maximumVersion = LATEST_SCHEMA_VERSION,
  skippedVersions: ReadonlySet<number> = new Set(),
): Promise<void> {
  await database.execAsync(`CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const appliedRows = await database.getAllAsync<{ version: number }>(
    'SELECT version FROM _migrations',
  );
  const appliedVersions = new Set(appliedRows.map((row) => row.version));

  for (const migration of migrations) {
    if (migration.version > maximumVersion) continue;
    if (skippedVersions.has(migration.version)) continue;
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    await database.execAsync('BEGIN IMMEDIATE TRANSACTION');

    try {
      for (const statement of migration.statements) {
        await database.execAsync(statement);
      }

      await database.runAsync(
        'INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)',
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
      await database.execAsync(`PRAGMA user_version = ${migration.version}`);
      await database.execAsync('COMMIT');
    } catch (error) {
      await database.execAsync('ROLLBACK');
      throw error;
    }
  }

  const finalVersion = await database.getFirstAsync<{ version: number | null }>(
    'SELECT MAX(version) AS version FROM _migrations',
  );
  if (finalVersion?.version) {
    await database.execAsync(`PRAGMA user_version = ${finalVersion.version}`);
  }
}
