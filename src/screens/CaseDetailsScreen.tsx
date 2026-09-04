import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppCard } from '../components/AppCard';
import { EmptyState } from '../components/EmptyState';
import { PrimaryButton } from '../components/PrimaryButton';
import { SectionTitle } from '../components/SectionTitle';
import { StatusBadge } from '../components/StatusBadge';
import type { Case } from '../models/Case';
import type { CaseDocument } from '../models/CaseDocument';
import type { CaseHistory } from '../models/CaseHistory';
import type { CaseDetailsScreenProps } from '../navigation/types';
import { getCaseById } from '../repositories/caseRepository';
import { getHistoryByCaseId } from '../repositories/caseHistoryRepository';
import { getDocumentsByCaseId } from '../repositories/documentRepository';
import { getIncompleteTaskCount } from '../repositories/caseTaskRepository';
import { deleteCaseWithLocalData } from '../services/caseLifecycleService';
import {
  chooseImageForCase,
  choosePdfForCase,
  takePhotoForCase,
  type DocumentImportResult,
} from '../services/documentService';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { formatDisplayDate } from '../utils/date';
import { representedSideLabel } from '../utils/caseFormat';
import { formatPaymentAmountMinor } from '../utils/payment';

export function CaseDetailsScreen({ navigation, route }: CaseDetailsScreenProps) {
  const [caseItem, setCaseItem] = useState<Case | null>(null);
  const [history, setHistory] = useState<CaseHistory[]>([]);
  const [documents, setDocuments] = useState<CaseDocument[]>([]);
  const [incompleteTaskCount, setIncompleteTaskCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [importingDocument, setImportingDocument] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { caseId } = route.params;

  const loadCase = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [loadedCase, loadedHistory, loadedDocuments, loadedTaskCount] = await Promise.all([
        getCaseById(caseId),
        getHistoryByCaseId(caseId),
        getDocumentsByCaseId(caseId),
        getIncompleteTaskCount(caseId),
      ]);
      setCaseItem(loadedCase);
      setHistory(loadedCase ? loadedHistory : []);
      setDocuments(loadedCase ? loadedDocuments : []);
      setIncompleteTaskCount(loadedCase ? loadedTaskCount : 0);
    } catch (loadError) {
      console.error('Unable to load case details.', loadError);
      setError('The case details, documents, and hearing history could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useFocusEffect(useCallback(() => { void loadCase(); }, [loadCase]));

  function confirmDelete() {
    Alert.alert(
      'Delete Case?',
      'This case and its related locally stored records will be permanently removed from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void handleDelete() },
      ],
    );
  }

  function showDocumentOptions() {
    if (importingDocument) return;
    Alert.alert('Add Document', 'Choose a document source.', [
      { text: 'Choose PDF', onPress: () => void importDocument(() => choosePdfForCase(caseId)) },
      { text: 'Choose Image', onPress: () => void importDocument(() => chooseImageForCase(caseId)) },
      { text: 'Take Photo', onPress: () => void importDocument(() => takePhotoForCase(caseId)) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function importDocument(task: () => Promise<DocumentImportResult>) {
    if (importingDocument) return;
    setImportingDocument(true);
    try {
      const result = await task();
      if (result.status === 'permission-denied') {
        Alert.alert('Camera permission needed', 'Allow camera access to capture a document photo.');
      } else if (result.status === 'saved') {
        await loadCase();
      }
    } catch (importError) {
      console.error('Unable to add case document.', importError);
      Alert.alert('Unable to add document', 'The selected file could not be saved. Please try again.');
    } finally {
      setImportingDocument(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      const result = await deleteCaseWithLocalData(caseId);
      if (!result.deleted) Alert.alert('Case not found', 'This case has already been removed from the device.');
      if (result.fileCleanupFailed) Alert.alert('Case removed', 'The case was deleted, but an unused local file directory could not be cleaned up.');
      navigation.popTo('MainTabs', { screen: 'Cases' });
    } catch (deleteError) {
      console.error('Unable to delete case.', deleteError);
      Alert.alert('Unable to delete case', 'Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return <SafeAreaView style={styles.screen} edges={['bottom']}><View style={styles.stateContainer}><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.stateText}>Loading case details…</Text></View></SafeAreaView>;
  }

  if (error) {
    return <SafeAreaView style={styles.screen} edges={['bottom']}><EmptyState icon="alert-circle-outline" title="Unable to load case" message={error} actionLabel="Try again" onAction={() => void loadCase()} /></SafeAreaView>;
  }

  if (!caseItem) {
    return <SafeAreaView style={styles.screen} edges={['bottom']}><EmptyState icon="document-outline" title="Case not found" message="This case may have been removed from the device." actionLabel="View Cases" onAction={() => navigation.popTo('MainTabs', { screen: 'Cases' })} /></SafeAreaView>;
  }

  const listItems: CaseDetailListItem[] = [
    ...(documents.length > 0
      ? documents.map((document): CaseDetailListItem => ({ kind: 'document', document }))
      : [{ kind: 'emptyDocuments' } as const]),
    { kind: 'historyHeading' },
    ...(history.length > 0
      ? history.map((item): CaseDetailListItem => ({ kind: 'history', item }))
      : [{ kind: 'emptyHistory' } as const]),
  ];
  const recentPayments = history.slice(0, 5);

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <FlatList
        data={listItems}
        keyExtractor={(item) => getListItemKey(item)}
        renderItem={({ item, index }) => {
          if (item.kind === 'document') {
            return <DocumentItem document={item.document} onPress={() => navigation.navigate('DocumentDetails', { documentId: item.document.id })} />;
          }
          if (item.kind === 'emptyDocuments') {
            return <EmptyState icon="folder-open-outline" title="No Documents Yet" message="Add court orders, petitions, evidence, notices, or other case files." actionLabel="Add Document" onAction={showDocumentOptions} />;
          }
          if (item.kind === 'historyHeading') {
            return <View style={styles.historyHeading}><SectionTitle title="Hearing History" /><Text style={styles.historyCount}>{history.length}</Text></View>;
          }
          if (item.kind === 'emptyHistory') {
            return <EmptyState icon="time-outline" title="No Hearing History Yet" message="Record a hearing update after the next court appearance to build this case's timeline." />;
          }
          return <HistoryItem item={item.item} isLast={index === listItems.length - 1} />;
        }}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.headerContent}>
            <AppCard style={styles.heroCard}>
              <View style={styles.heroTopRow}>
                <View style={styles.caseIcon}><Ionicons name="briefcase-outline" size={22} color={colors.primary} /></View>
                <StatusBadge status={caseItem.status} />
              </View>
              <Text style={styles.caseTitle}>{caseItem.caseTitle}</Text>
              <Text style={styles.caseNumber}>{caseItem.caseNumber}</Text>
              <View style={styles.courtRow}><Ionicons name="business-outline" size={16} color={colors.textMuted} /><Text style={styles.courtName}>{courtDisplayValue(caseItem)}</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Open to-do checklist, ${incompleteTaskCount} incomplete`} onPress={() => navigation.navigate('CaseTasks', { caseId })} style={({ pressed }) => [styles.todoButton, pressed && styles.editPressed]}><Ionicons name="checkbox-outline" size={20} color={colors.primary} /><Text style={styles.todoText}>To-do</Text><Text style={styles.todoCount}>{incompleteTaskCount}</Text></Pressable>
            </AppCard>

            <DetailSection title="Parties">
              <DetailRow label="Party" value={displayValue(caseItem.partyName)} />
              <DetailRow label="Opposite Party" value={displayValue(caseItem.oppositePartyName)} />
              <DetailRow label="We Represent" value={representedSideLabel(caseItem.representedSide)} />
            </DetailSection>

            <DetailSection title="Court Information">
              <DetailRow label="Court" value={courtDisplayValue(caseItem)} />
              <DetailRow label="Judge" value={displayValue(caseItem.judgeName)} />
            </DetailSection>

            <DetailSection title="Recent Payment History">
              {recentPayments.length ? recentPayments.map((payment) => <PaymentHistoryRow key={payment.id} item={payment} />) : <DetailRow label="Payment" value="Not recorded" />}
              {history.length > 5 ? <Text style={styles.helperText}>Showing the latest five. Earlier payment records remain visible in Hearing History below.</Text> : null}
            </DetailSection>

            <DetailSection title="Hearing Information">
              <DetailRow label="Previous Date" value={formatDisplayDate(caseItem.previousDate, 'Not provided')} />
              <DetailRow label="Previous Day Order" value={displayValue(caseItem.previousOrder)} />
              <DetailRow label="Next Date" value={formatDisplayDate(caseItem.nextDate, 'Not provided')} emphasized={Boolean(caseItem.nextDate)} />
              <DetailRow label="Next Day Step" value={displayValue(caseItem.nextStep)} />
            </DetailSection>

            <DetailSection title="Notes"><DetailRow label="Additional Notes" value={displayValue(caseItem.notes)} /></DetailSection>

            <View style={styles.actions}>
              <PrimaryButton label="Add Hearing Update" onPress={() => navigation.navigate('AddHearingUpdate', { caseId })} />
              <Pressable accessibilityRole="button" accessibilityLabel="Edit case" onPress={() => navigation.navigate('EditCase', { caseId })} style={({ pressed }) => [styles.editButton, pressed && styles.editPressed]}>
                <Ionicons name="create-outline" size={18} color={colors.primary} /><Text style={styles.editText}>Edit Case</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Delete case" disabled={deleting} onPress={confirmDelete} style={({ pressed }) => [styles.deleteButton, pressed && styles.deletePressed, deleting && styles.deleteDisabled]}>
                {deleting ? <ActivityIndicator color={colors.danger} /> : <><Ionicons name="trash-outline" size={18} color={colors.danger} /><Text style={styles.deleteText}>Delete Case</Text></>}
              </Pressable>
            </View>

            <View style={styles.documentsHeading}>
              <SectionTitle title="Documents" caption={`${documents.length}`} />
              <Pressable accessibilityRole="button" accessibilityLabel="Add document" disabled={importingDocument} onPress={showDocumentOptions} style={({ pressed }) => [styles.addDocumentButton, pressed && styles.editPressed]}>
                {importingDocument ? <ActivityIndicator color={colors.primary} /> : <><Ionicons name="add" size={19} color={colors.primary} /><Text style={styles.addDocumentText}>Add Document</Text></>}
              </Pressable>
            </View>
          </View>
        }
      />
    </SafeAreaView>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.section}><SectionTitle title={title} /><AppCard style={styles.detailCard}>{children}</AppCard></View>;
}

function DetailRow({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return <View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text style={[styles.detailValue, emphasized && styles.emphasizedValue]}>{value}</Text></View>;
}

type CaseDetailListItem =
  | { kind: 'document'; document: CaseDocument }
  | { kind: 'emptyDocuments' }
  | { kind: 'historyHeading' }
  | { kind: 'history'; item: CaseHistory }
  | { kind: 'emptyHistory' };

function getListItemKey(item: CaseDetailListItem): string {
  if (item.kind === 'document') return `document-${item.document.id}`;
  if (item.kind === 'history') return `history-${item.item.id}`;
  return item.kind;
}

function DocumentItem({ document, onPress }: { document: CaseDocument; onPress: () => void }) {
  return (
    <AppCard onPress={onPress} accessibilityLabel={`${document.fileName}, ${document.fileType}`} style={styles.documentCard}>
      <View style={styles.documentIcon}><Ionicons name={document.fileType === 'PDF' ? 'document-text-outline' : 'image-outline'} size={23} color={colors.primary} /></View>
      <View style={styles.documentText}><Text style={styles.documentName} numberOfLines={2}>{document.fileName}</Text>{document.description ? <Text style={styles.documentDescription} numberOfLines={2}>{document.description}</Text> : null}<Text style={styles.documentMeta}>{document.fileType} · {formatDisplayDate(document.createdAt)}</Text></View>
      <Ionicons name="chevron-forward" size={19} color={colors.textMuted} />
    </AppCard>
  );
}

function HistoryItem({ item, isLast }: { item: CaseHistory; isLast: boolean }) {
  return (
    <View style={styles.timelineRow}>
      <View style={styles.timelineRail}><View style={styles.timelineDot} />{isLast ? null : <View style={styles.timelineLine} />}</View>
      <AppCard style={styles.historyCard}>
        <Text style={styles.historyDate}>{formatDisplayDate(item.hearingDate)}</Text>
        <HistoryField label="Order" value={item.orderText} />
        <HistoryField label="Next Hearing" value={item.nextDate} date />
        <HistoryField label="Next Step" value={item.nextStep} />
        <HistoryField label="Notes" value={item.notes} />
        <HistoryField label="Payment" value={paymentDisplayValue(item)} />
        <HistoryField label="Payment Note" value={item.paymentNote} />
      </AppCard>
    </View>
  );
}

function PaymentHistoryRow({ item }: { item: CaseHistory }) {
  return <View style={styles.paymentRow}><Text style={styles.paymentDate}>{formatDisplayDate(item.hearingDate)}</Text><Text style={styles.paymentStatus}>{paymentDisplayValue(item)}</Text></View>;
}

function paymentDisplayValue(item: CaseHistory): string {
  if (!item.paymentStatus) return 'Not recorded';
  const amount = item.paymentStatus === 'PAID' ? formatPaymentAmountMinor(item.paymentAmountMinor) : '';
  return item.paymentStatus === 'PAID' ? `Paid${amount ? ` · ৳${amount}` : ''}` : 'Unpaid';
}

function courtDisplayValue(caseItem: Case): string {
  return caseItem.courtShortCode ? `${caseItem.courtName} (${caseItem.courtShortCode})` : displayValue(caseItem.courtName);
}

function HistoryField({ label, value, date = false }: { label: string; value: string | null; date?: boolean }) {
  if (!value?.trim()) return null;
  return <View style={styles.historyField}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{date ? formatDisplayDate(value) : value}</Text></View>;
}

function displayValue(value: string | null | undefined): string {
  return value?.trim() || 'Not provided';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { gap: spacing.xxl, padding: spacing.xl, paddingBottom: spacing.xxxl },
  headerContent: { gap: spacing.xxl },
  stateContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  stateText: { ...typography.body, color: colors.textMuted },
  heroCard: { gap: spacing.sm, padding: spacing.xl },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  caseIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primarySoft },
  caseTitle: { ...typography.display, marginTop: spacing.sm, color: colors.text },
  caseNumber: { ...typography.bodyStrong, color: colors.primary },
  courtRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.sm },
  courtName: { ...typography.body, flex: 1, color: colors.textMuted },
  section: { gap: spacing.md },
  detailCard: { gap: spacing.xl },
  detailRow: { gap: spacing.xs },
  detailLabel: { ...typography.label, color: colors.textMuted },
  detailValue: { ...typography.body, color: colors.text },
  emphasizedValue: { ...typography.bodyStrong, color: colors.primary },
  actions: { gap: spacing.md },
  todoButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: spacing.sm, marginTop: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  todoText: { ...typography.bodyStrong, color: colors.primary },
  todoCount: { ...typography.caption, minWidth: 24, paddingHorizontal: spacing.xs, paddingVertical: 2, overflow: 'hidden', textAlign: 'center', borderRadius: radius.pill, backgroundColor: colors.primary, color: colors.surface },
  documentsHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  addDocumentButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  addDocumentText: { ...typography.bodyStrong, color: colors.primary },
  documentCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  documentIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primarySoft },
  documentText: { flex: 1, gap: spacing.xs },
  documentName: { ...typography.bodyStrong, color: colors.text },
  documentDescription: { ...typography.caption, color: colors.textMuted },
  documentMeta: { ...typography.caption, color: colors.primary },
  editButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, backgroundColor: colors.surface },
  editPressed: { backgroundColor: colors.primarySoft },
  editText: { ...typography.bodyStrong, color: colors.primary },
  deleteButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  deletePressed: { backgroundColor: colors.dangerBackground },
  deleteDisabled: { opacity: 0.55 },
  deleteText: { ...typography.bodyStrong, color: colors.danger },
  historyHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  historyCount: { ...typography.caption, minWidth: 28, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, overflow: 'hidden', textAlign: 'center', borderRadius: radius.pill, backgroundColor: colors.primarySoft, color: colors.primary },
  timelineRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.md },
  timelineRail: { width: 16, alignItems: 'center' },
  timelineDot: { width: 12, height: 12, marginTop: spacing.lg, borderWidth: 3, borderColor: colors.primarySoft, borderRadius: radius.pill, backgroundColor: colors.primary },
  timelineLine: { flex: 1, width: 2, marginTop: spacing.xs, marginBottom: -spacing.xxl, backgroundColor: colors.border },
  historyCard: { flex: 1, gap: spacing.lg },
  historyDate: { ...typography.subheading, color: colors.primary },
  historyField: { gap: spacing.xs },
  paymentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  paymentDate: { ...typography.body, color: colors.text },
  paymentStatus: { ...typography.bodyStrong, color: colors.primary },
  helperText: { ...typography.caption, color: colors.textMuted },
});
