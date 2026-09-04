import { getDatabase } from '../database/database';
import type { CaseTask, CreateCaseTaskInput, UpdateCaseTaskInput } from '../models/CaseTask';
import { isValidDateOnly } from '../utils/date';
import { createId } from '../utils/id';

interface CaseTaskRow {
  id: string;
  case_id: string;
  title: string;
  note: string | null;
  due_date: string | null;
  is_completed: number;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
}

const TASK_COLUMNS = 'id, case_id, title, note, due_date, is_completed, created_at, completed_at, updated_at';

export async function getTasksByCaseId(caseId: string): Promise<CaseTask[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<CaseTaskRow>(
    `SELECT ${TASK_COLUMNS} FROM case_tasks WHERE case_id = ?
     ORDER BY is_completed ASC,
       CASE WHEN due_date IS NULL THEN 1 ELSE 0 END ASC,
       due_date ASC, created_at ASC, id ASC`,
    caseId,
  );
  return rows.map(mapTask);
}

export async function getAllCaseTasks(): Promise<CaseTask[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<CaseTaskRow>(
    `SELECT ${TASK_COLUMNS} FROM case_tasks ORDER BY case_id ASC, created_at ASC, id ASC`,
  );
  return rows.map(mapTask);
}

export async function getIncompleteTaskCount(caseId: string): Promise<number> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM case_tasks WHERE case_id = ? AND is_completed = 0',
    caseId,
  );
  return row?.count ?? 0;
}

export async function createCaseTask(input: CreateCaseTaskInput): Promise<CaseTask> {
  const normalized = normalizeTaskInput(input);
  const database = await getDatabase();
  const id = createId();
  const timestamp = new Date().toISOString();
  await database.runAsync(
    `INSERT INTO case_tasks (
      id, case_id, title, note, due_date, is_completed, created_at, completed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, ?, NULL, ?)`,
    id,
    normalized.caseId,
    normalized.title,
    normalized.note,
    normalized.dueDate,
    timestamp,
    timestamp,
  );
  const row = await database.getFirstAsync<CaseTaskRow>(
    `SELECT ${TASK_COLUMNS} FROM case_tasks WHERE id = ?`,
    id,
  );
  if (!row) throw new Error('The task was saved but could not be retrieved.');
  return mapTask(row);
}

export async function updateCaseTask(id: string, input: UpdateCaseTaskInput): Promise<CaseTask | null> {
  const database = await getDatabase();
  const existing = await database.getFirstAsync<CaseTaskRow>(
    `SELECT ${TASK_COLUMNS} FROM case_tasks WHERE id = ?`,
    id,
  );
  if (!existing) return null;
  const normalized = normalizeTaskInput({
    caseId: existing.case_id,
    title: input.title ?? existing.title,
    note: input.note === undefined ? existing.note : input.note,
    dueDate: input.dueDate === undefined ? existing.due_date : input.dueDate,
  });
  await database.runAsync(
    'UPDATE case_tasks SET title = ?, note = ?, due_date = ?, updated_at = ? WHERE id = ?',
    normalized.title,
    normalized.note,
    normalized.dueDate,
    nextTimestamp(existing.updated_at),
    id,
  );
  const row = await database.getFirstAsync<CaseTaskRow>(
    `SELECT ${TASK_COLUMNS} FROM case_tasks WHERE id = ?`,
    id,
  );
  return row ? mapTask(row) : null;
}

export async function setCaseTaskCompleted(id: string, completed: boolean): Promise<CaseTask | null> {
  const database = await getDatabase();
  const existing = await database.getFirstAsync<CaseTaskRow>(
    `SELECT ${TASK_COLUMNS} FROM case_tasks WHERE id = ?`,
    id,
  );
  if (!existing) return null;
  const timestamp = nextTimestamp(existing.updated_at);
  await database.runAsync(
    'UPDATE case_tasks SET is_completed = ?, completed_at = ?, updated_at = ? WHERE id = ?',
    completed ? 1 : 0,
    completed ? timestamp : null,
    timestamp,
    id,
  );
  const row = await database.getFirstAsync<CaseTaskRow>(
    `SELECT ${TASK_COLUMNS} FROM case_tasks WHERE id = ?`,
    id,
  );
  return row ? mapTask(row) : null;
}

export async function deleteCaseTask(id: string): Promise<boolean> {
  const database = await getDatabase();
  const result = await database.runAsync('DELETE FROM case_tasks WHERE id = ?', id);
  return result.changes > 0;
}

function normalizeTaskInput(input: CreateCaseTaskInput) {
  const caseId = input.caseId.trim();
  const title = input.title.trim();
  const note = input.note?.trim() || null;
  const dueDate = input.dueDate?.trim() || null;
  if (!caseId) throw new Error('A case is required.');
  if (!title) throw new Error('Task title is required.');
  if (title.length > 300 || (note?.length ?? 0) > 3000) throw new Error('Task text is too long.');
  if (dueDate && !isValidDateOnly(dueDate)) throw new Error('Due date must use YYYY-MM-DD format.');
  return { caseId, title, note, dueDate };
}

function mapTask(row: CaseTaskRow): CaseTask {
  return {
    id: row.id,
    caseId: row.case_id,
    title: row.title,
    note: row.note,
    dueDate: row.due_date,
    completed: row.is_completed === 1,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

function nextTimestamp(previous: string): string {
  const current = Date.now();
  const prior = Date.parse(previous);
  return new Date(Number.isNaN(prior) ? current : Math.max(current, prior + 1)).toISOString();
}
