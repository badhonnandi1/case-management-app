import { checkFts5Capability, getDatabase } from '../database/database';
import { recoverInterruptedAiSources } from '../repositories/aiSourceRepository';

export interface AiAssistantAvailability {
  available: boolean;
  message: string | null;
  sqliteVersion: string;
}

export async function checkAiAssistantAvailability(): Promise<AiAssistantAvailability> {
  const database = await getDatabase();
  const fts = await checkFts5Capability(database);
  if (!fts.available) {
    return {
      available: false,
      message: 'Full-text search is unavailable in this SQLite build. Other app features are unaffected.',
      sqliteVersion: fts.sqliteVersion,
    };
  }
  const migration = await database.getFirstAsync<{ version: number }>(
    'SELECT version FROM _migrations WHERE version = 4',
  );
  if (!migration) {
    return {
      available: false,
      message: 'Local AI search is unavailable because its database upgrade was not applied.',
      sqliteVersion: 'unknown',
    };
  }
  await recoverInterruptedAiSources();
  return {
    available: true,
    message: null,
    sqliteVersion: fts.sqliteVersion,
  };
}
