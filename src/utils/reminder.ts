import type { Case } from '../models/Case';
import type { ReminderDaysBefore, ReminderSettings } from '../models/CaseReminder';

const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

export function calculateReminderDate(
  hearingDate: string,
  daysBefore: ReminderDaysBefore,
  time: string,
  now = new Date(),
): Date | null {
  if (!isValidLocalDate(hearingDate)) return null;
  const timeMatch = TIME_PATTERN.exec(time);
  if (!timeMatch) return null;
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) return null;

  const [yearText, monthText, dayText] = hearingDate.split('-');
  const reminder = new Date(
    Number(yearText),
    Number(monthText) - 1,
    Number(dayText),
    hour,
    minute,
    0,
    0,
  );
  reminder.setDate(reminder.getDate() - daysBefore);
  return reminder.getTime() > now.getTime() ? reminder : null;
}

export function shouldScheduleCaseReminder(
  caseItem: Case,
  settings: ReminderSettings,
  now = new Date(),
): Date | null {
  if (!settings.enabled || caseItem.status === 'CLOSED' || !caseItem.nextDate) return null;
  return calculateReminderDate(caseItem.nextDate, settings.daysBefore, settings.time, now);
}

export function getReminderTitle(daysBefore: ReminderDaysBefore): string {
  if (daysBefore === 0) return 'Hearing Today';
  if (daysBefore === 1) return 'Hearing Tomorrow';
  return `Hearing in ${daysBefore} Days`;
}

function isValidLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}
