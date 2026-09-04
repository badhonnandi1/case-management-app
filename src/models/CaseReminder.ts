export interface CaseReminder {
  caseId: string;
  notificationId: string;
  scheduledFor: string;
  updatedAt: string;
}

export type ReminderDaysBefore = 0 | 1 | 3 | 7;

export interface ReminderSettings {
  enabled: boolean;
  daysBefore: ReminderDaysBefore;
  time: string;
}
