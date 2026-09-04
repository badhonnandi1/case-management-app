import * as SQLite from 'expo-sqlite';

import { runMigrations } from './migrations';
import { seedDevelopmentData } from './seed';

const DATABASE_NAME = 'case_management.db';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
let initializationPromise: Promise<void> | null = null;

export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME).catch((error: unknown) => {
      databasePromise = null;
      throw error;
    });
  }

  return databasePromise;
}

export function initializeDatabase(): Promise<void> {
  if (!initializationPromise) {
    initializationPromise = performInitialization().catch((error: unknown) => {
      initializationPromise = null;
      throw error;
    });
  }

  return initializationPromise;
}

async function performInitialization(): Promise<void> {
  const database = await getDatabase();
  await database.execAsync('PRAGMA foreign_keys = ON');
  await database.execAsync('PRAGMA journal_mode = WAL');
  const fts5 = await checkFts5Capability(database);
  // Keep the existing offline app usable on an unexpected SQLite build without
  // FTS5. Migration 4 remains pending and retrieval is never downgraded to LIKE.
  await runMigrations(database, undefined, fts5.available ? undefined : new Set([4]));
  if (!fts5.available) {
    console.error(`Local AI indexing is unavailable because FTS5 is missing: ${fts5.reason ?? 'unknown error'}`);
  }
  await seedDevelopmentData(database);
}

export interface Fts5Capability {
  available: boolean;
  sqliteVersion: string;
  compiledWithFts5: boolean;
  reason: string | null;
}

export async function checkFts5Capability(
  database: SQLite.SQLiteDatabase,
): Promise<Fts5Capability> {
  const versionRow = await database.getFirstAsync<{ sqlite_version: string }>(
    'SELECT sqlite_version() AS sqlite_version',
  );
  const compileRow = await database.getFirstAsync<{ enabled: number }>(
    "SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled",
  );
  const probeName = 'temp.__case_management_fts5_probe';
  try {
    await database.execAsync(`CREATE VIRTUAL TABLE ${probeName} USING fts5(content)`);
    await database.execAsync(`DROP TABLE ${probeName}`);
    return {
      available: true,
      sqliteVersion: versionRow?.sqlite_version ?? 'unknown',
      compiledWithFts5: compileRow?.enabled === 1,
      reason: null,
    };
  } catch (error) {
    try {
      await database.execAsync(`DROP TABLE IF EXISTS ${probeName}`);
    } catch {
      // Preserve the original capability error.
    }
    return {
      available: false,
      sqliteVersion: versionRow?.sqlite_version ?? 'unknown',
      compiledWithFts5: compileRow?.enabled === 1,
      reason: error instanceof Error ? error.message : 'FTS5 probe failed',
    };
  }
}
