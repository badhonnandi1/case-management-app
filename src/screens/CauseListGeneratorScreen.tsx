import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppCard } from '../components/AppCard';
import { EmptyState } from '../components/EmptyState';
import { PrimaryButton } from '../components/PrimaryButton';
import { SectionTitle } from '../components/SectionTitle';
import type { Case } from '../models/Case';
import type { CauseListOptions, CauseListSort, GeneratedCauseList } from '../models/CauseList';
import type { CauseListGeneratorScreenProps } from '../navigation/types';
import { getCasesByHearingDate } from '../repositories/caseRepository';
import { generateCauseListPdf } from '../services/causeListService';
import { openPdf, shareFile } from '../services/fileService';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { formatLongDate } from '../utils/date';
import { buildCauseListLine } from '../utils/caseFormat';

const INITIAL_OPTIONS: CauseListOptions = {
  sortBy: 'COURT',
  includePartyNames: true,
  includeJudge: true,
  includePreviousOrder: true,
  includeNextStep: true,
};

const SORT_OPTIONS: readonly { value: CauseListSort; label: string }[] = [
  { value: 'COURT', label: 'Court Name' },
  { value: 'CASE_NUMBER', label: 'Case Number' },
  { value: 'CASE_TITLE', label: 'Case Title' },
];

export function CauseListGeneratorScreen({ navigation, route }: CauseListGeneratorScreenProps) {
  const [cases, setCases] = useState<Case[]>([]);
  const [options, setOptions] = useState<CauseListOptions>(INITIAL_OPTIONS);
  const [result, setResult] = useState<GeneratedCauseList | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [actionBusy, setActionBusy] = useState<'open' | 'share' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(false);
  const { selectedDate } = route.params;

  const loadCases = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCases(await getCasesByHearingDate(selectedDate));
    } catch (loadError) {
      console.error('Unable to load cause list cases.', loadError);
      setError('Cases for this cause list could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => { void loadCases(); }, [loadCases]);

  async function handleGenerate() {
    if (generationRef.current || cases.length === 0) return;
    generationRef.current = true;
    setGenerating(true);
    try {
      setResult(await generateCauseListPdf(selectedDate, cases, options));
    } catch (generationError) {
      console.error('Unable to generate cause list PDF.', generationError);
      Alert.alert('Unable to generate PDF', 'The Daily Cause List could not be created. Please try again.');
    } finally {
      generationRef.current = false;
      setGenerating(false);
    }
  }

  async function handleOpen() {
    if (!result || actionBusy) return;
    setActionBusy('open');
    try {
      await openPdf(result.uri);
    } catch (openError) {
      console.error('Unable to open generated cause list.', openError);
      Alert.alert('Unable to open PDF', 'No compatible PDF app may be installed. You can share the PDF instead.');
    } finally {
      setActionBusy(null);
    }
  }

  async function handleShare() {
    if (!result || actionBusy) return;
    setActionBusy('share');
    try {
      await shareFile(result.uri, 'PDF');
    } catch (shareError) {
      console.error('Unable to share generated cause list.', shareError);
      Alert.alert('Unable to share PDF', 'The file may be missing or sharing may be unavailable.');
    } finally {
      setActionBusy(null);
    }
  }

  if (loading) return <SafeAreaView style={styles.screen} edges={['bottom']}><View style={styles.state}><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.stateText}>Preparing cause list…</Text></View></SafeAreaView>;
  if (error) return <SafeAreaView style={styles.screen} edges={['bottom']}><EmptyState icon="alert-circle-outline" title="Unable to load cases" message={error} actionLabel="Try again" onAction={() => void loadCases()} /></SafeAreaView>;
  if (cases.length === 0) return <SafeAreaView style={styles.screen} edges={['bottom']}><EmptyState icon="calendar-clear-outline" title="No Cases Scheduled" message="There are no cases scheduled for this date." actionLabel="Go Back" onAction={navigation.goBack} /></SafeAreaView>;
  if (result) return <CauseListResult result={result} date={selectedDate} actionBusy={actionBusy} onOpen={() => void handleOpen()} onShare={() => void handleShare()} onDone={navigation.goBack} />;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <FlatList
        data={cases}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item, index }) => (
          <AppCard style={styles.caseCard}>
            <Text style={styles.caseIndex}>{index + 1}</Text>
            <View style={styles.caseText}><Text style={styles.caseTitle}>{buildCauseListLine(item)}</Text></View>
          </AppCard>
        )}
        ListHeaderComponent={
          <View style={styles.headerContent}>
            <AppCard style={styles.dateCard}><Ionicons name="calendar-outline" size={24} color={colors.primary} /><View><Text style={styles.dateLabel}>CAUSE LIST DATE</Text><Text style={styles.dateText}>{formatLongDate(selectedDate)}</Text><Text style={styles.caseCount}>{cases.length} {cases.length === 1 ? 'case' : 'cases'} scheduled</Text></View></AppCard>
            <View style={styles.section}><SectionTitle title="Sort By" /><View style={styles.chips}>{SORT_OPTIONS.map((item) => <Pressable key={item.value} accessibilityRole="radio" accessibilityState={{ checked: options.sortBy === item.value }} onPress={() => setOptions((current) => ({ ...current, sortBy: item.value }))} style={[styles.chip, options.sortBy === item.value && styles.chipSelected]}><Text style={[styles.chipText, options.sortBy === item.value && styles.chipTextSelected]}>{item.label}</Text></Pressable>)}</View></View>
            <View style={styles.section}><SectionTitle title="Include Fields" /><AppCard style={styles.optionCard}>
              <OptionToggle label="Party Names" value={options.includePartyNames} onChange={(value) => setOptions((current) => ({ ...current, includePartyNames: value }))} />
              <OptionToggle label="Judge" value={options.includeJudge} onChange={(value) => setOptions((current) => ({ ...current, includeJudge: value }))} />
              <OptionToggle label="Previous Order" value={options.includePreviousOrder} onChange={(value) => setOptions((current) => ({ ...current, includePreviousOrder: value }))} />
              <OptionToggle label="Next Step" value={options.includeNextStep} onChange={(value) => setOptions((current) => ({ ...current, includeNextStep: value }))} />
            </AppCard></View>
            <SectionTitle title="Scheduled Cases" caption={`${cases.length}`} />
          </View>
        }
        ListFooterComponent={<View style={styles.footer}><PrimaryButton label="Generate Cause List" loading={generating} disabled={generating} onPress={() => void handleGenerate()} /></View>}
      />
    </SafeAreaView>
  );
}

function OptionToggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return <View style={styles.optionRow}><Text style={styles.optionLabel}>{label}</Text><Switch accessibilityLabel={`Include ${label}`} value={value} onValueChange={onChange} trackColor={{ false: colors.border, true: colors.primarySoft }} thumbColor={value ? colors.primary : colors.textMuted} /></View>;
}

function CauseListResult({ result, date, actionBusy, onOpen, onShare, onDone }: { result: GeneratedCauseList; date: string; actionBusy: 'open' | 'share' | null; onOpen: () => void; onShare: () => void; onDone: () => void }) {
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.resultContent}>
        <View style={styles.successIcon}><Ionicons name="checkmark" size={34} color={colors.active} /></View>
        <Text style={styles.resultTitle}>Cause List Generated</Text>
        <Text style={styles.resultSubtitle}>The PDF is stored permanently on this device.</Text>
        <AppCard style={styles.resultCard}>
          <ResultRow label="Date" value={formatLongDate(date)} />
          <ResultRow label="Cases" value={String(result.caseCount)} />
          <ResultRow label="Pages" value={String(result.pageCount)} />
          <ResultRow label="Filename" value={result.fileName} />
        </AppCard>
        <View style={styles.resultActions}>
          <PrimaryButton label="Open PDF" loading={actionBusy === 'open'} disabled={actionBusy !== null} onPress={onOpen} />
          <Pressable accessibilityRole="button" disabled={actionBusy !== null} onPress={onShare} style={styles.outlineButton}>{actionBusy === 'share' ? <ActivityIndicator color={colors.primary} /> : <><Ionicons name="share-social-outline" size={18} color={colors.primary} /><Text style={styles.outlineText}>Share PDF</Text></>}</Pressable>
          <Pressable accessibilityRole="button" disabled={actionBusy !== null} onPress={onDone} style={styles.doneButton}><Text style={styles.doneText}>Done</Text></Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.resultRow}><Text style={styles.resultLabel}>{label}</Text><Text style={styles.resultValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  stateText: { ...typography.body, color: colors.textMuted },
  content: { padding: spacing.xl, paddingBottom: spacing.xxxl },
  headerContent: { gap: spacing.xl, marginBottom: spacing.xl },
  dateCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, backgroundColor: colors.primarySoft },
  dateLabel: { ...typography.label, color: colors.textMuted },
  dateText: { ...typography.subheading, marginTop: spacing.xs, color: colors.text },
  caseCount: { ...typography.caption, marginTop: spacing.xs, color: colors.primary },
  section: { gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, backgroundColor: colors.surface },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { ...typography.caption, color: colors.textMuted },
  chipTextSelected: { ...typography.bodyStrong, color: colors.primary },
  optionCard: { paddingVertical: 0 },
  optionRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  optionLabel: { ...typography.body, color: colors.text },
  caseCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  caseIndex: { ...typography.bodyStrong, width: 24, color: colors.primary },
  caseText: { flex: 1, gap: spacing.xs },
  caseTitle: { ...typography.bodyStrong, color: colors.text },
  caseMeta: { ...typography.caption, color: colors.textMuted },
  separator: { height: spacing.md },
  footer: { marginTop: spacing.xl },
  resultContent: { flexGrow: 1, justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
  successIcon: { width: 72, height: 72, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.activeBackground },
  resultTitle: { ...typography.heading, textAlign: 'center', color: colors.text },
  resultSubtitle: { ...typography.body, textAlign: 'center', color: colors.textMuted },
  resultCard: { gap: spacing.lg, marginTop: spacing.md },
  resultRow: { gap: spacing.xs },
  resultLabel: { ...typography.label, color: colors.textMuted },
  resultValue: { ...typography.body, color: colors.text },
  resultActions: { gap: spacing.md, marginTop: spacing.md },
  outlineButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, backgroundColor: colors.surface },
  outlineText: { ...typography.bodyStrong, color: colors.primary },
  doneButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  doneText: { ...typography.bodyStrong, color: colors.textMuted },
});
