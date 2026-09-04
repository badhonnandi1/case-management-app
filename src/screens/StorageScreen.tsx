import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppCard } from '../components/AppCard';
import { EmptyState } from '../components/EmptyState';
import {
  cleanUnusedDocumentFiles,
  deleteGeneratedCauseLists,
  scanStorageHealth,
  type StorageHealthReport,
} from '../services/storageService';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { formatFileSize } from '../utils/storage';

type BusyAction = 'scan' | 'orphans' | 'cause-lists' | null;

export function StorageScreen() {
  const [report, setReport] = useState<StorageHealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>('scan');
  const actionRef = useRef(false);

  const loadReport = useCallback(async () => {
    setBusyAction('scan');
    setError(null);
    try {
      setReport(await scanStorageHealth());
    } catch (scanError) {
      console.error('Unable to scan app-managed storage.', scanError);
      setError('Storage information could not be loaded.');
    } finally {
      setBusyAction(null);
    }
  }, []);

  useFocusEffect(useCallback(() => { void loadReport(); }, [loadReport]));

  function confirmOrphanCleanup() {
    if (!report || report.orphanFiles.length === 0) return;
    Alert.alert(
      'Unused Files Found',
      `${report.orphanFiles.length} ${report.orphanFiles.length === 1 ? 'file' : 'files'} · ${formatFileSize(report.orphanBytes)}\n\nRemove these files?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void handleOrphanCleanup() },
      ],
    );
  }

  async function handleOrphanCleanup() {
    if (actionRef.current) return;
    actionRef.current = true;
    setBusyAction('orphans');
    try {
      const result = await cleanUnusedDocumentFiles();
      Alert.alert('Cleanup Complete', `${result.count} ${result.count === 1 ? 'file was' : 'files were'} removed.`);
      await loadReport();
    } catch (cleanupError) {
      console.error('Unable to remove unused document files.', cleanupError);
      Alert.alert('Cleanup failed', 'Unused files could not all be removed. No case records were changed.');
    } finally {
      actionRef.current = false;
      setBusyAction(null);
    }
  }

  function confirmCauseListCleanup() {
    if (!report || report.causeListCount === 0) return;
    Alert.alert(
      'Delete Generated Cause Lists?',
      `Remove ${report.causeListCount} generated ${report.causeListCount === 1 ? 'PDF' : 'PDFs'} (${formatFileSize(report.causeListBytes)})? Cases and attachments will not be affected.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void handleCauseListCleanup() },
      ],
    );
  }

  async function handleCauseListCleanup() {
    if (actionRef.current) return;
    actionRef.current = true;
    setBusyAction('cause-lists');
    try {
      const count = deleteGeneratedCauseLists();
      Alert.alert('Cause Lists Deleted', `${count} generated ${count === 1 ? 'PDF was' : 'PDFs were'} removed.`);
      await loadReport();
    } catch (cleanupError) {
      console.error('Unable to delete generated Cause Lists.', cleanupError);
      Alert.alert('Unable to delete', 'Generated Cause Lists could not all be removed.');
    } finally {
      actionRef.current = false;
      setBusyAction(null);
    }
  }

  if (busyAction === 'scan' && !report) return <SafeAreaView style={styles.screen} edges={['bottom']}><View style={styles.state}><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.stateText}>Checking local storage…</Text></View></SafeAreaView>;
  if (error || !report) return <SafeAreaView style={styles.screen} edges={['bottom']}><EmptyState icon="alert-circle-outline" title="Unable to check storage" message={error ?? 'Storage information is unavailable.'} actionLabel="Try again" onAction={() => void loadReport()} /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>APP DATA</Text>
          <AppCard style={styles.statsCard}>
            <StatRow label="Cases" value={String(report.caseCount)} />
            <StatRow label="Documents" value={String(report.documentCount)} />
            <StatRow label="Document Storage" value={formatFileSize(report.documentBytes)} />
            <StatRow label="Cause Lists" value={String(report.causeListCount)} />
            <StatRow label="Cause List Storage" value={formatFileSize(report.causeListBytes)} />
            <StatRow label="Backups" value={String(report.backupCount)} />
            <StatRow label="Backup Storage" value={formatFileSize(report.backupBytes)} />
          </AppCard>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>STORAGE HEALTH</Text>
          <AppCard style={styles.healthCard}>
            <View style={styles.healthHeader}><View style={[styles.iconContainer, report.orphanFiles.length === 0 && report.missingDocumentCount === 0 && styles.healthyIcon]}><Ionicons name={report.orphanFiles.length === 0 && report.missingDocumentCount === 0 ? 'checkmark-circle-outline' : 'warning-outline'} size={23} color={report.orphanFiles.length === 0 && report.missingDocumentCount === 0 ? colors.active : colors.pending} /></View><View style={styles.flex}><Text style={styles.title}>{report.orphanFiles.length === 0 && report.missingDocumentCount === 0 ? 'Storage looks healthy' : 'Storage needs attention'}</Text><Text style={styles.description}>{report.orphanFiles.length} unused physical files · {report.missingDocumentCount} missing attachment records</Text></View></View>
            {report.missingDocumentCount > 0 ? <Text style={styles.notice}>Missing files are not removed automatically. Open the affected Document Details screen to remove its record if needed.</Text> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Clean unused files" disabled={report.orphanFiles.length === 0 || busyAction !== null} onPress={confirmOrphanCleanup} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, (report.orphanFiles.length === 0 || busyAction !== null) && styles.disabled]}>{busyAction === 'orphans' ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.secondaryText}>Clean Unused Files</Text>}</Pressable>
          </AppCard>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>GENERATED FILES</Text>
          <AppCard style={styles.healthCard}>
            <Text style={styles.title}>Daily Cause Lists</Text>
            <Text style={styles.description}>Generated PDFs can be recreated from the calendar at any time.</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Delete generated Cause Lists" disabled={report.causeListCount === 0 || busyAction !== null} onPress={confirmCauseListCleanup} style={({ pressed }) => [styles.dangerButton, pressed && styles.pressed, (report.causeListCount === 0 || busyAction !== null) && styles.disabled]}>{busyAction === 'cause-lists' ? <ActivityIndicator color={colors.danger} /> : <Text style={styles.dangerText}>Delete Generated Cause Lists</Text>}</Pressable>
          </AppCard>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.statRow}><Text style={styles.statLabel}>{label}</Text><Text style={styles.statValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { gap: spacing.xxl, padding: spacing.xl, paddingBottom: spacing.xxxl },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  stateText: { ...typography.body, color: colors.textMuted },
  section: { gap: spacing.md },
  sectionTitle: { ...typography.label, color: colors.textMuted },
  statsCard: { gap: spacing.md },
  statRow: { minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg },
  statLabel: { ...typography.body, flex: 1, color: colors.textMuted },
  statValue: { ...typography.bodyStrong, color: colors.text },
  healthCard: { gap: spacing.lg },
  healthHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconContainer: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.pendingBackground },
  healthyIcon: { backgroundColor: colors.activeBackground },
  flex: { flex: 1 },
  title: { ...typography.bodyStrong, color: colors.text },
  description: { ...typography.body, marginTop: spacing.xs, color: colors.textMuted },
  notice: { ...typography.caption, padding: spacing.md, borderRadius: radius.md, color: colors.pending, backgroundColor: colors.pendingBackground },
  secondaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md },
  secondaryText: { ...typography.bodyStrong, color: colors.primary },
  dangerButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md },
  dangerText: { ...typography.bodyStrong, color: colors.danger },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
});
