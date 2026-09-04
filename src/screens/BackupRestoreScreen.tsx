import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppCard } from '../components/AppCard';
import { PrimaryButton } from '../components/PrimaryButton';
import type { CreatedBackup, ValidatedBackup } from '../models/Backup';
import type { BackupRestoreScreenProps } from '../navigation/types';
import {
  createPortableBackup,
  createAndShareCaseCsv,
  discardValidatedBackup,
  getLatestBackup,
  restoreValidatedBackup,
  selectAndValidateBackup,
  shareBackup,
} from '../services/backupService';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { formatDisplayDateTime } from '../utils/date';
import { formatFileSize } from '../utils/storage';

type BusyAction = 'create' | 'export' | 'restore' | 'share' | null;
interface LocalBackupSummary {
  uri: string;
  fileName: string;
  size: number;
  createdAt: string;
}

export function BackupRestoreScreen({ navigation }: BackupRestoreScreenProps) {
  const [latestBackup, setLatestBackup] = useState<LocalBackupSummary | null>(null);
  const [createdBackup, setCreatedBackup] = useState<CreatedBackup | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const actionRef = useRef(false);

  const refreshLatest = useCallback(() => {
    try {
      const latest = getLatestBackup();
      setLatestBackup(latest ? {
        uri: latest.uri,
        fileName: latest.name,
        size: latest.size,
        createdAt: new Date(latest.modificationTime ?? Date.now()).toISOString(),
      } : null);
    } catch (error) {
      console.error('Unable to inspect local backups.', error);
      setLatestBackup(null);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    refreshLatest();
  }, [refreshLatest]));

  async function runAction(action: Exclude<BusyAction, null>, task: () => Promise<void>) {
    if (actionRef.current) return;
    actionRef.current = true;
    setBusyAction(action);
    try {
      await task();
    } finally {
      actionRef.current = false;
      setBusyAction(null);
    }
  }

  async function handleCreateBackup() {
    await runAction('create', async () => {
      try {
        const created = await createPortableBackup();
        setCreatedBackup(created);
        setLatestBackup({ uri: created.uri, fileName: created.fileName, size: created.size, createdAt: created.manifest.createdAt });
      } catch (error) {
        console.error('Unable to create backup.', error);
        Alert.alert('Backup not created', 'Your current data was not changed. Please try again.');
      }
    });
  }

  async function handleCsvExport() {
    await runAction('export', async () => {
      try {
        await createAndShareCaseCsv();
      } catch (error) {
        console.error('Unable to export case data.', error);
        Alert.alert('Export not created', 'The Excel-compatible CSV could not be created or shared. Please try again.');
      }
    });
  }

  async function handleShare(uri: string) {
    await runAction('share', async () => {
      try {
        await shareBackup(uri);
      } catch (error) {
        console.error('Unable to share backup.', error);
        Alert.alert('Unable to share', 'The backup may be missing or sharing may be unavailable.');
      }
    });
  }

  async function handleSelectRestore() {
    await runAction('restore', async () => {
      try {
        const result = await selectAndValidateBackup();
        if (result.status === 'cancelled') return;
        showRestoreConfirmation(result.backup);
      } catch (error) {
        console.error('Unable to validate selected backup.', error);
        Alert.alert('Backup not supported', getRestoreValidationMessage(error));
      }
    });
  }

  function showRestoreConfirmation(backup: ValidatedBackup) {
    const { manifest } = backup;
    Alert.alert(
      'Restore Backup?',
      `Backup created: ${formatDisplayDateTime(manifest.createdAt)}\n\nCases: ${manifest.caseCount}\nHearing Records: ${manifest.historyCount}\nDocuments: ${manifest.documentCount}\n\nThis will replace the current case-management data on this device.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => discardValidatedBackup(backup) },
        { text: 'Restore', style: 'destructive', onPress: () => void performRestore(backup) },
      ],
      { cancelable: false },
    );
  }

  async function performRestore(backup: ValidatedBackup) {
    await runAction('restore', async () => {
      try {
        const result = await restoreValidatedBackup(backup);
        const warnings = [
          result.cleanupWarning ? 'Some obsolete local files could not be removed.' : null,
          result.reminderWarning ? 'Hearing reminders will be retried when the app next starts.' : null,
        ].filter(Boolean).join('\n');
        Alert.alert(
          'Restore Complete',
          `${result.caseCount} cases, ${result.historyCount} hearing records, and ${result.documentCount} documents were restored.${warnings ? `\n\n${warnings}` : ''}`,
          [{ text: 'Done', onPress: () => navigation.popTo('MainTabs', { screen: 'Home' }) }],
        );
      } catch (error) {
        console.error('Unable to restore backup.', error);
        Alert.alert('Restore failed', 'Current case data was kept whenever possible. Please try again.');
      }
    });
  }

  if (createdBackup) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.successIcon}><Ionicons name="checkmark" size={34} color={colors.active} /></View>
          <Text style={styles.successTitle}>Backup Created</Text>
          <Text style={styles.successMessage}>The backup is stored locally. Export a copy before uninstalling or clearing app data.</Text>
          <AppCard style={styles.summaryCard}>
            <SummaryRow label="Cases" value={String(createdBackup.manifest.caseCount)} />
            <SummaryRow label="Hearing Records" value={String(createdBackup.manifest.historyCount)} />
            <SummaryRow label="Documents" value={String(createdBackup.manifest.documentCount)} />
            {createdBackup.manifest.skippedDocumentCount > 0 ? <SummaryRow label="Missing Documents Skipped" value={String(createdBackup.manifest.skippedDocumentCount)} warning /> : null}
            <View style={styles.divider} />
            <Text style={styles.fileName}>{createdBackup.fileName}</Text>
            <Text style={styles.fileSize}>{formatFileSize(createdBackup.size)}</Text>
          </AppCard>
          <PrimaryButton label="Share Backup" loading={busyAction === 'share'} disabled={busyAction !== null} onPress={() => void handleShare(createdBackup.uri)} />
          <Pressable accessibilityRole="button" accessibilityLabel="Done with backup" onPress={() => setCreatedBackup(null)} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}><Text style={styles.secondaryText}>Done</Text></Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <AppCard style={styles.infoCard}>
          <View style={styles.infoIcon}><Ionicons name="shield-checkmark-outline" size={24} color={colors.primary} /></View>
          <View style={styles.flex}><Text style={styles.title}>Export or protect your data</Text><Text style={styles.description}>Use CSV for a readable Excel file. Use Full Restore Backup to preserve cases, history, attachments, and settings for recovery.</Text></View>
        </AppCard>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>LAST BACKUP</Text>
          <AppCard>
            {latestBackup ? <><Text style={styles.title}>{formatDisplayDateTime(latestBackup.createdAt)}</Text><Text style={styles.description}>{latestBackup.fileName} · {formatFileSize(latestBackup.size)}</Text></> : <><Text style={styles.title}>No Backups Yet</Text><Text style={styles.description}>Create and export a backup to protect local case data.</Text></>}
          </AppCard>
        </View>

        <View style={styles.actions}>
          <PrimaryButton label="Export Case Data (.csv)" loading={busyAction === 'export'} disabled={busyAction !== null} onPress={() => void handleCsvExport()} />
          <Text style={styles.exportHelp}>Readable in Microsoft Excel and Google Sheets. Includes case data in English and Bangla.</Text>
          <PrimaryButton label="Create Full Restore Backup" loading={busyAction === 'create'} disabled={busyAction !== null} onPress={() => void handleCreateBackup()} />
          <Pressable accessibilityRole="button" accessibilityLabel="Restore backup" disabled={busyAction !== null} onPress={() => void handleSelectRestore()} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, busyAction !== null && styles.disabled]}>{busyAction === 'restore' ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.secondaryText}>Restore Backup</Text>}</Pressable>
          {latestBackup ? <Pressable accessibilityRole="button" accessibilityLabel="Share latest backup" disabled={busyAction !== null} onPress={() => void handleShare(latestBackup.uri)} style={({ pressed }) => [styles.textButton, pressed && styles.pressed, busyAction !== null && styles.disabled]}><Ionicons name="share-social-outline" size={18} color={colors.primary} /><Text style={styles.textButtonLabel}>Share Latest Backup</Text></Pressable> : null}
        </View>

        <Text style={styles.warning}>Backup files may contain confidential case information. Store and share them securely.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryRow({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return <View style={styles.summaryRow}><Text style={[styles.summaryLabel, warning && styles.warningText]}>{label}</Text><Text style={[styles.summaryValue, warning && styles.warningText]}>{value}</Text></View>;
}

function getRestoreValidationMessage(error: unknown): string {
  if (error instanceof Error && /backup|case|document|hearing|setting|format|schema/i.test(error.message)) return error.message;
  return 'The selected file is damaged or is not a supported Case Management backup.';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { gap: spacing.xl, padding: spacing.xl, paddingBottom: spacing.xxxl },
  infoCard: { flexDirection: 'row', gap: spacing.md },
  infoIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primarySoft },
  flex: { flex: 1 },
  title: { ...typography.bodyStrong, color: colors.text },
  description: { ...typography.body, marginTop: spacing.xs, color: colors.textMuted },
  section: { gap: spacing.md },
  sectionTitle: { ...typography.label, color: colors.textMuted },
  actions: { gap: spacing.md },
  secondaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, backgroundColor: colors.surface },
  secondaryText: { ...typography.bodyStrong, color: colors.primary },
  textButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  textButtonLabel: { ...typography.bodyStrong, color: colors.primary },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
  warning: { ...typography.caption, padding: spacing.md, borderRadius: radius.md, color: colors.pending, backgroundColor: colors.pendingBackground },
  exportHelp: { ...typography.caption, marginTop: -spacing.sm, color: colors.textMuted },
  successIcon: { width: 68, height: 68, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.activeBackground },
  successTitle: { ...typography.heading, textAlign: 'center', color: colors.text },
  successMessage: { ...typography.body, textAlign: 'center', color: colors.textMuted },
  summaryCard: { gap: spacing.md },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.lg },
  summaryLabel: { ...typography.body, flex: 1, color: colors.textMuted },
  summaryValue: { ...typography.bodyStrong, color: colors.text },
  warningText: { color: colors.pending },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider },
  fileName: { ...typography.bodyStrong, color: colors.text },
  fileSize: { ...typography.caption, color: colors.textMuted },
});
