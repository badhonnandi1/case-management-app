import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Case } from '../models/Case';
import type { ReminderDaysBefore, ReminderSettings } from '../models/CaseReminder';
import { getAllCases } from '../repositories/caseRepository';
import {
  deleteCaseReminder,
  getAllCaseReminders,
  getCaseReminder,
  saveCaseReminder,
} from '../repositories/caseReminderRepository';
import { getSettingValue, setSetting } from '../repositories/settingsRepository';
import { getReminderTitle, shouldScheduleCaseReminder } from '../utils/reminder';

export const REMINDER_CHANNEL_ID = 'hearing-reminders';
export const REMINDERS_ENABLED_KEY = 'reminders_enabled';
export const REMINDER_DAYS_KEY = 'reminder_days_before';
export const REMINDER_TIME_KEY = 'reminder_time';
export const DEFAULT_REMINDER_TIME = '08:00';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function initializeNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: 'Hearing reminders',
    description: 'Local reminders for scheduled court hearings',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
    enableVibrate: true,
  });
}

export async function requestNotificationPermission(): Promise<boolean> {
  await initializeNotificationChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function getReminderSettings(): Promise<ReminderSettings> {
  const [enabledValue, daysValue, time] = await Promise.all([
    getSettingValue(REMINDERS_ENABLED_KEY, 'false'),
    getSettingValue(REMINDER_DAYS_KEY, '1'),
    getSettingValue(REMINDER_TIME_KEY, DEFAULT_REMINDER_TIME),
  ]);
  return {
    enabled: enabledValue === 'true',
    daysBefore: parseReminderDays(daysValue),
    time: /^\d{2}:\d{2}$/.test(time) ? time : DEFAULT_REMINDER_TIME,
  };
}

export async function setRemindersEnabled(enabled: boolean): Promise<void> {
  await setSetting(REMINDERS_ENABLED_KEY, String(enabled));
  if (!enabled) await cancelAllCaseRemindersIfNeeded();
}

export async function setDefaultReminderDays(daysBefore: ReminderDaysBefore): Promise<void> {
  await setSetting(REMINDER_DAYS_KEY, String(daysBefore));
}

export async function setDefaultReminderTime(time: string): Promise<void> {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Invalid reminder time.');
  await setSetting(REMINDER_TIME_KEY, time);
}

export async function scheduleCaseReminder(caseItem: Case): Promise<boolean> {
  const settings = await getReminderSettings();
  return scheduleCaseReminderWithSettings(caseItem, settings);
}

async function scheduleCaseReminderWithSettings(
  caseItem: Case,
  settings: ReminderSettings,
): Promise<boolean> {
  const reminderDate = shouldScheduleCaseReminder(caseItem, settings);
  if (!reminderDate) {
    await cancelCaseReminder(caseItem.id);
    return false;
  }

  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) {
    await cancelCaseReminder(caseItem.id);
    return false;
  }

  await initializeNotificationChannel();
  await cancelCaseReminder(caseItem.id);
  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: getReminderTitle(settings.daysBefore),
      body: buildReminderBody(caseItem),
      sound: 'default',
      data: { caseId: caseItem.id },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: reminderDate,
      channelId: REMINDER_CHANNEL_ID,
    },
  });

  try {
    await saveCaseReminder(caseItem.id, notificationId, reminderDate.toISOString());
  } catch (error) {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
    throw error;
  }
  return true;
}

export const rescheduleCaseReminder = scheduleCaseReminder;

export async function cancelCaseReminder(caseId: string): Promise<void> {
  const reminder = await getCaseReminder(caseId);
  if (!reminder) return;
  await Notifications.cancelScheduledNotificationAsync(reminder.notificationId);
  await deleteCaseReminder(caseId);
}

export async function cancelAllCaseRemindersIfNeeded(): Promise<void> {
  const reminders = await getAllCaseReminders();
  for (const reminder of reminders) {
    await Notifications.cancelScheduledNotificationAsync(reminder.notificationId);
    await deleteCaseReminder(reminder.caseId);
  }
}

export async function syncScheduledReminders(): Promise<void> {
  const settings = await getReminderSettings();
  if (!settings.enabled) {
    await cancelAllCaseRemindersIfNeeded();
    return;
  }

  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) {
    await cancelAllCaseRemindersIfNeeded();
    return;
  }

  await initializeNotificationChannel();
  const [cases, reminders, scheduledRequests] = await Promise.all([
    getAllCases(),
    getAllCaseReminders(),
    Notifications.getAllScheduledNotificationsAsync(),
  ]);
  const scheduledIds = new Set(scheduledRequests.map((request) => request.identifier));
  const reminderByCase = new Map(reminders.map((reminder) => [reminder.caseId, reminder]));
  const desiredCases = new Map<string, { caseItem: Case; scheduledFor: string }>();

  for (const caseItem of cases) {
    const reminderDate = shouldScheduleCaseReminder(caseItem, settings);
    if (reminderDate) {
      desiredCases.set(caseItem.id, { caseItem, scheduledFor: reminderDate.toISOString() });
    }
  }

  for (const reminder of reminders) {
    const desired = desiredCases.get(reminder.caseId);
    if (!desired || desired.scheduledFor !== reminder.scheduledFor || !scheduledIds.has(reminder.notificationId)) {
      await cancelCaseReminder(reminder.caseId);
    }
  }

  for (const [caseId, desired] of desiredCases) {
    const existing = reminderByCase.get(caseId);
    if (!existing || existing.scheduledFor !== desired.scheduledFor || !scheduledIds.has(existing.notificationId)) {
      try {
        await scheduleCaseReminderWithSettings(desired.caseItem, settings);
      } catch (error) {
        console.error(`Unable to synchronize reminder for case ${caseId}.`, error);
      }
    }
  }
}

function parseReminderDays(value: string): ReminderDaysBefore {
  if (value === '0' || value === '3' || value === '7') return Number(value) as ReminderDaysBefore;
  return 1;
}

function buildReminderBody(caseItem: Case): string {
  const summary = `${caseItem.caseNumber} · ${caseItem.courtName}`;
  const nextStep = caseItem.nextStep?.trim();
  return nextStep ? `${summary}\nNext: ${nextStep.slice(0, 120)}` : summary;
}
