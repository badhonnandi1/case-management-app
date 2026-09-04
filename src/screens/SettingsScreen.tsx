import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppCard } from '../components/AppCard';
import { AppHeader } from '../components/AppHeader';
import { AiSettingsSection } from '../components/ai/AiSettingsSection';
import { EmptyState } from '../components/EmptyState';
import { LATEST_SCHEMA_VERSION } from '../database/migrations';
import type { ReminderDaysBefore, ReminderSettings } from '../models/CaseReminder';
import type { SettingsScreenProps } from '../navigation/types';
import {
  getReminderSettings,
  requestNotificationPermission,
  setDefaultReminderDays,
  setDefaultReminderTime,
  setRemindersEnabled,
  syncScheduledReminders,
} from '../services/notificationService';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

const REMINDER_OPTIONS: readonly { value: ReminderDaysBefore; label: string }[] = [
  { value: 0, label: 'Same Day' },
  { value: 1, label: '1 Day Before' },
  { value: 3, label: '3 Days Before' },
  { value: 7, label: '7 Days Before' },
];

export function SettingsScreen({ navigation }: SettingsScreenProps) {
  const [settings, setSettings] = useState<ReminderSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSettings(await getReminderSettings());
    } catch (loadError) {
      console.error('Unable to load reminder settings.', loadError);
      setError('Reminder settings could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void loadSettings(); }, [loadSettings]));

  async function handleToggle(enabled: boolean) {
    if (!settings || saving) return;
    setSaving(true);
    try {
      if (enabled) {
        const granted = await requestNotificationPermission();
        if (!granted) {
          await setRemindersEnabled(false);
          setSettings((current) => current ? { ...current, enabled: false } : current);
          Alert.alert('Notifications are disabled', 'Enable notification permission in Android settings to use hearing reminders.');
          return;
        }
      }
      await setRemindersEnabled(enabled);
      setSettings((current) => current ? { ...current, enabled } : current);
      if (enabled) await syncScheduledReminders();
    } catch (saveError) {
      console.error('Unable to change reminder setting.', saveError);
      Alert.alert('Unable to update reminders', 'The reminder setting could not be saved. Please try again.');
      await loadSettings();
    } finally {
      setSaving(false);
    }
  }

  async function handleInterval(daysBefore: ReminderDaysBefore) {
    if (!settings || saving || settings.daysBefore === daysBefore) return;
    setSaving(true);
    try {
      await setDefaultReminderDays(daysBefore);
      setSettings((current) => current ? { ...current, daysBefore } : current);
      if (settings.enabled) await syncScheduledReminders();
    } catch (saveError) {
      console.error('Unable to update reminder interval.', saveError);
      Alert.alert('Unable to update reminders', 'The reminder interval could not be saved.');
      await loadSettings();
    } finally {
      setSaving(false);
    }
  }

  function handleTimePicker() {
    if (!settings || saving || !settings.enabled) return;
    const [hour = 8, minute = 0] = settings.time.split(':').map(Number);
    const value = new Date();
    value.setHours(hour, minute, 0, 0);
    DateTimePickerAndroid.open({
      value,
      mode: 'time',
      is24Hour: false,
      display: 'clock',
      onChange: (event, selected) => {
        if (event.type !== 'set' || !selected) return;
        const time = `${String(selected.getHours()).padStart(2, '0')}:${String(selected.getMinutes()).padStart(2, '0')}`;
        void handleTime(time);
      },
    });
  }

  async function handleTime(time: string) {
    if (!settings || saving || settings.time === time) return;
    setSaving(true);
    try {
      await setDefaultReminderTime(time);
      setSettings((current) => current ? { ...current, time } : current);
      if (settings.enabled) await syncScheduledReminders();
    } catch (saveError) {
      console.error('Unable to update reminder time.', saveError);
      Alert.alert('Unable to update reminders', 'The reminder time could not be saved.');
      await loadSettings();
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <AppHeader title="Settings" subtitle="Application preferences" />
      {loading ? (
        <View style={styles.state}><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.stateText}>Loading settings…</Text></View>
      ) : error || !settings ? (
        <EmptyState icon="alert-circle-outline" title="Unable to load settings" message={error ?? 'Settings are unavailable.'} actionLabel="Try again" onAction={() => void loadSettings()} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>HEARING REMINDERS</Text>
            <AppCard style={styles.reminderCard}>
              <View style={styles.toggleRow}>
                <View style={styles.iconContainer}><Ionicons name="notifications-outline" size={21} color={colors.primary} /></View>
                <View style={styles.textContainer}><Text style={styles.title}>Enable Reminders</Text><Text style={styles.description}>Local alerts for upcoming hearings</Text></View>
                {saving ? <ActivityIndicator color={colors.primary} /> : <Switch accessibilityLabel="Enable hearing reminders" value={settings.enabled} onValueChange={(value) => void handleToggle(value)} trackColor={{ false: colors.border, true: colors.primarySoft }} thumbColor={settings.enabled ? colors.primary : colors.textMuted} />}
              </View>
              <View style={styles.divider} />
              <View style={styles.intervalSection}>
                <Text style={styles.title}>Default Reminder</Text>
                <Text style={styles.description}>Choose how early and at what local time notifications appear.</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Choose reminder time"
                  disabled={!settings.enabled || saving}
                  onPress={handleTimePicker}
                  style={({ pressed }) => [styles.timePicker, pressed && styles.optionPressed, !settings.enabled && styles.optionDisabled]}
                >
                  <View><Text style={styles.timeLabel}>REMINDER TIME</Text><Text style={styles.timeValue}>{formatReminderTime(settings.time)}</Text></View>
                  <Ionicons name="time-outline" size={22} color={colors.primary} />
                </Pressable>
                <View style={styles.options}>
                  {REMINDER_OPTIONS.map((option) => {
                    const selected = settings.daysBefore === option.value;
                    return <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: !settings.enabled }} disabled={!settings.enabled || saving} onPress={() => void handleInterval(option.value)} style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.optionPressed, !settings.enabled && styles.optionDisabled]}><Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</Text>{selected ? <Ionicons name="checkmark-circle" size={18} color={colors.primary} /> : null}</Pressable>;
                  })}
                </View>
              </View>
            </AppCard>
          </View>

          <AiSettingsSection onOpenAi={() => navigation.navigate('AI')} />

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>DATA</Text>
            <AppCard style={styles.menuCard}>
              <SettingsLink icon="archive-outline" title="Backup, Export & Restore" description="Export Excel-compatible CSV or manage a full backup" onPress={() => navigation.navigate('BackupRestore')} />
              <View style={styles.menuDivider} />
              <SettingsLink icon="server-outline" title="Storage" description="Review local storage and clean generated files" onPress={() => navigation.navigate('Storage')} />
            </AppCard>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>APP</Text>
            <AppCard style={styles.aboutCard}>
              <View style={styles.aboutHeader}><View style={styles.iconContainer}><Ionicons name="briefcase-outline" size={21} color={colors.primary} /></View><View style={styles.textContainer}><Text style={styles.title}>Case Management</Text><Text style={styles.description}>Version {Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? 'Unknown'}</Text></View></View>
              <Text style={styles.aboutText}>Offline-first Case Management and Court Diary for Android.</Text>
              <Text style={styles.databaseVersion}>Database version {LATEST_SCHEMA_VERSION}</Text>
            </AppCard>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { gap: spacing.xxl, paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  stateText: { ...typography.body, color: colors.textMuted },
  section: { gap: spacing.md },
  sectionTitle: { ...typography.label, color: colors.textMuted },
  reminderCard: { paddingVertical: spacing.md },
  toggleRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconContainer: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primarySoft },
  textContainer: { flex: 1 },
  title: { ...typography.bodyStrong, color: colors.text },
  description: { ...typography.caption, marginTop: spacing.xs, color: colors.textMuted },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.md, backgroundColor: colors.divider },
  intervalSection: { gap: spacing.md },
  options: { gap: spacing.sm },
  option: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  optionSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionPressed: { opacity: 0.75 },
  optionDisabled: { opacity: 0.48 },
  optionText: { ...typography.body, color: colors.text },
  optionTextSelected: { ...typography.bodyStrong, color: colors.primary },
  timePicker: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  timeLabel: { ...typography.label, color: colors.textMuted },
  timeValue: { ...typography.bodyStrong, marginTop: spacing.xs, color: colors.primary },
  menuCard: { paddingVertical: spacing.xs },
  menuRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  menuPressed: { opacity: 0.7 },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider },
  aboutCard: { gap: spacing.lg },
  aboutHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  aboutText: { ...typography.body, color: colors.text },
  databaseVersion: { ...typography.caption, color: colors.textMuted },
});

function SettingsLink({ icon, title, description, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; description: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [styles.menuRow, pressed && styles.menuPressed]}><View style={styles.iconContainer}><Ionicons name={icon} size={20} color={colors.primary} /></View><View style={styles.textContainer}><Text style={styles.title}>{title}</Text><Text style={styles.description}>{description}</Text></View><Ionicons name="chevron-forward" size={18} color={colors.textMuted} /></Pressable>;
}

function formatReminderTime(value: string): string {
  const [hourText, minute] = value.split(':');
  const hour = Number(hourText);
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${period}`;
}
