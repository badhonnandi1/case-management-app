import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { Case } from '../../models/Case';
import type { AiDocumentChoice } from '../../models/AiUi';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';
import {
  aiDocumentStatusLabel,
  formatAiFileSize,
  groupAiDocumentsByCase,
  selectEligibleDocumentIds,
  toggleSelectedId,
} from '../../utils/aiUi';
import { EmptyState } from '../EmptyState';
import { PrimaryButton } from '../PrimaryButton';

interface DocumentSelectorProps {
  cases: readonly Case[];
  choices: readonly AiDocumentChoice[];
  selectedIds: readonly string[];
  loading: boolean;
  checkedCount: number;
  totalCount: number;
  error: string | null;
  onChange: (ids: string[]) => void;
  onBack: () => void;
  onContinue: () => void;
  onRetryLoad: () => void;
}

interface DocumentSection { caseItem: Case; data: AiDocumentChoice[] }

export function DocumentSelector(props: DocumentSelectorProps) {
  const sections = useMemo<DocumentSection[]>(() => groupAiDocumentsByCase(props.cases, props.choices)
    .map((group) => ({ caseItem: group.caseItem, data: group.choices })), [props.cases, props.choices]);
  const selectedIdSet = useMemo(() => new Set(props.selectedIds), [props.selectedIds]);
  const selectedUsable = props.choices.some((choice) =>
    selectedIdSet.has(choice.document.id) && choice.processable,
  );

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Return to case selection" onPress={props.onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={22} color={colors.primary} />
        </Pressable>
        <View style={styles.headingText}>
          <Text style={styles.heading}>Select Documents</Text>
          <Text style={styles.subheading}>{props.selectedIds.length} selected · selected cases define the case scope</Text>
        </View>
      </View>

      <View style={styles.selectionActions}>
        <Pressable accessibilityRole="button" onPress={() => props.onChange(selectEligibleDocumentIds(props.selectedIds, props.choices))} style={styles.textButton}>
          <Text style={styles.textButtonLabel}>Select all eligible</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={props.selectedIds.length === 0} onPress={() => props.onChange([])} style={styles.textButton}>
          <Text style={[styles.textButtonLabel, props.selectedIds.length === 0 && styles.disabledText]}>Clear selection</Text>
        </Pressable>
      </View>

      {props.loading ? (
        <View style={styles.state}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.stateText}>Checking local files… {props.checkedCount}/{props.totalCount}</Text>
        </View>
      ) : props.error ? (
        <EmptyState icon="alert-circle-outline" title="Unable to check documents" message={props.error} actionLabel="Try again" onAction={props.onRetryLoad} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.document.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={[styles.list, sections.length === 0 && styles.emptyList]}
          renderSectionHeader={({ section }) => {
            const eligibleCount = section.data.filter((choice) => choice.selectable).length;
            return (
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleWrap}>
                  <Text style={styles.sectionTitle}>{section.caseItem.caseTitle}</Text>
                  <Text style={styles.sectionMeta}>{section.caseItem.caseNumber} · {section.data.length} documents</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={eligibleCount === 0}
                  onPress={() => props.onChange(selectEligibleDocumentIds(props.selectedIds, props.choices, section.caseItem.id))}
                  style={styles.caseSelectButton}
                >
                  <Text style={[styles.caseSelectText, eligibleCount === 0 && styles.disabledText]}>Select eligible</Text>
                </Pressable>
              </View>
            );
          }}
          renderItem={({ item }) => {
            const checked = selectedIdSet.has(item.document.id);
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked, disabled: !item.selectable }}
                accessibilityLabel={`${item.document.fileName}, ${aiDocumentStatusLabel(item.status)}`}
                disabled={!item.selectable}
                onPress={() => props.onChange(toggleSelectedId(props.selectedIds, item.document.id))}
                style={({ pressed }) => [styles.row, checked && styles.rowSelected, !item.selectable && styles.rowDisabled, pressed && styles.pressed]}
              >
                <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={25} color={checked ? colors.primary : colors.textMuted} />
                <View style={styles.fileIcon}>
                  <Ionicons name={item.document.fileType === 'PDF' ? 'document-text-outline' : 'image-outline'} size={22} color={colors.primary} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.fileName} numberOfLines={2}>{item.document.fileName}</Text>
                  <Text style={styles.fileMeta}>{item.document.fileType} · {formatAiFileSize(item.fileSize)}</Text>
                  <View style={styles.statusLine}>
                    <Ionicons name={statusIcon(item.status)} size={15} color={statusColor(item.status)} />
                    <Text style={[styles.statusText, { color: statusColor(item.status) }]}>{aiDocumentStatusLabel(item.status)}</Text>
                  </View>
                  {item.message ? <Text style={styles.warningText}>{item.message}</Text> : null}
                </View>
              </Pressable>
            );
          }}
          renderSectionFooter={({ section }) => section.data.length === 0 ? (
            <View style={styles.noDocuments}><Text style={styles.stateText}>No documents in this case.</Text></View>
          ) : <View style={styles.sectionGap} />}
          ListEmptyComponent={<EmptyState icon="folder-open-outline" title="No selected cases" message="Return to case selection and choose at least one case." />}
        />
      )}

      <View style={styles.footer}>
        <Text style={styles.footerNote}>Missing and unsupported files are never included by select-all.</Text>
        <PrimaryButton label="Prepare Selected Documents" disabled={!selectedUsable || props.loading} onPress={props.onContinue} />
      </View>
    </View>
  );
}

function statusColor(status: AiDocumentChoice['status']): string {
  if (status === 'ready') return colors.active;
  if (status === 'missing' || status === 'unsupported' || status === 'failed') return colors.danger;
  if (status === 'changed' || status === 'requires_ocr' || status === 'interrupted') return colors.pending;
  return colors.textMuted;
}

function statusIcon(status: AiDocumentChoice['status']): keyof typeof Ionicons.glyphMap {
  if (status === 'ready') return 'checkmark-circle-outline';
  if (status === 'missing') return 'cloud-offline-outline';
  if (status === 'requires_ocr') return 'scan-outline';
  if (status === 'failed' || status === 'unsupported') return 'alert-circle-outline';
  if (status === 'changed' || status === 'interrupted') return 'refresh-circle-outline';
  return 'ellipse-outline';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  headingText: { flex: 1 },
  heading: { ...typography.heading, color: colors.text },
  subheading: { ...typography.caption, color: colors.textMuted },
  selectionActions: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingBottom: spacing.sm },
  textButton: { minHeight: 44, justifyContent: 'center' },
  textButtonLabel: { ...typography.caption, fontWeight: '600', color: colors.primary },
  disabledText: { color: colors.textMuted },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  stateText: { ...typography.body, color: colors.textMuted },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  emptyList: { flexGrow: 1 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  sectionTitleWrap: { flex: 1 },
  sectionTitle: { ...typography.subheading, color: colors.text },
  sectionMeta: { ...typography.caption, color: colors.textMuted },
  caseSelectButton: { minHeight: 44, justifyContent: 'center' },
  caseSelectText: { ...typography.caption, fontWeight: '600', color: colors.primary },
  row: { minHeight: 88, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.lg, marginBottom: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  rowSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  rowDisabled: { opacity: 0.62 },
  pressed: { opacity: 0.8 },
  fileIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primarySoft },
  rowText: { flex: 1, gap: 3 },
  fileName: { ...typography.bodyStrong, color: colors.text },
  fileMeta: { ...typography.caption, color: colors.textMuted },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statusText: { ...typography.caption, fontWeight: '600' },
  warningText: { ...typography.caption, color: colors.textMuted },
  noDocuments: { padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surface },
  sectionGap: { height: spacing.sm },
  footer: { gap: spacing.sm, paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xl, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surface },
  footerNote: { ...typography.caption, color: colors.textMuted },
});
