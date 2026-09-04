import { getDatabase } from '../database/database';
import type { AppSettings } from '../models/AppSettings';
import { createId } from '../utils/id';

interface SettingsRow {
  id: string;
  key: string;
  value: string;
  updated_at: string;
}

function mapSettings(row: SettingsRow): AppSettings {
  return {
    id: row.id,
    key: row.key,
    value: row.value,
    updatedAt: row.updated_at,
  };
}

export async function getSetting(key: string): Promise<AppSettings | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<SettingsRow>(
    'SELECT id, key, value, updated_at FROM settings WHERE key = ?',
    key,
  );
  return row ? mapSettings(row) : null;
}

export async function getAllSettings(): Promise<AppSettings[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<SettingsRow>(
    'SELECT id, key, value, updated_at FROM settings ORDER BY key ASC',
  );
  return rows.map(mapSettings);
}

export async function setSetting(key: string, value: string): Promise<AppSettings> {
  const database = await getDatabase();
  const existing = await getSetting(key);
  const setting: AppSettings = {
    id: existing?.id ?? createId(),
    key,
    value,
    updatedAt: new Date().toISOString(),
  };

  await database.runAsync(
    `INSERT INTO settings (id, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    setting.id,
    setting.key,
    setting.value,
    setting.updatedAt,
  );

  return setting;
}

export async function deleteSetting(key: string): Promise<boolean> {
  const database = await getDatabase();
  const result = await database.runAsync('DELETE FROM settings WHERE key = ?', key);
  return result.changes > 0;
}

export async function getSettingValue(key: string, fallback: string): Promise<string> {
  const setting = await getSetting(key);
  return setting?.value ?? fallback;
}
