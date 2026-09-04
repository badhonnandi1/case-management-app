import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useCallback, useMemo, useRef } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import type { AiMessageWithCitations } from '../../models/AiMessage';
import type { Case } from '../../models/Case';
import type { CaseDocument } from '../../models/CaseDocument';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';
import { formatDisplayDateTime } from '../../utils/date';
import { EmptyState } from '../EmptyState';
import { SourceCitation } from './SourceCitation';

interface AiConversationListProps {
  entries: readonly AiMessageWithCitations[];
  cases: readonly Case[];
  documents: readonly CaseDocument[];
  freshInsufficientMessageIds: ReadonlySet<string>;
  warningsByMessageId: ReadonlyMap<string, readonly string[]>;
  regenerationDisabled: boolean;
  onOpenCitation: (entry: AiMessageWithCitations, citationIndex: number) => void;
  onCopyAnswer: (content: string) => void;
  onRegenerate: (assistantMessageId: string) => void;
}

export const AiConversationList = memo(function AiConversationList(props: AiConversationListProps) {
  const listRef = useRef<FlatList<AiMessageWithCitations>>(null);
  const shouldFollowRef = useRef(true);
  const caseMap = useMemo(() => new Map(props.cases.map((item) => [item.id, item])), [props.cases]);
  const documentMap = useMemo(() => new Map(props.documents.map((item) => [item.id, item])), [props.documents]);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    shouldFollowRef.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 96;
  }, []);

  return (
    <FlatList
      ref={listRef}
      data={props.entries}
      keyExtractor={(entry) => entry.message.id}
      contentContainerStyle={[styles.list, props.entries.length === 0 && styles.emptyList]}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      onScroll={onScroll}
      scrollEventThrottle={80}
      onContentSizeChange={() => {
        if (shouldFollowRef.current) listRef.current?.scrollToEnd({ animated: props.entries.length > 1 });
      }}
      ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title="Ask from your prepared sources" message="Relevant excerpts are found locally first. Only selected excerpts are sent online after consent. Verify every answer against its citations; local search remains available without sending anything." />}
      renderItem={({ item, index }) => {
        const assistant = item.message.role === 'assistant';
        const previousRole = props.entries[index - 1]?.message.role;
        const regenerated = assistant && previousRole === 'assistant';
        const warnings = props.warningsByMessageId.get(item.message.id) ?? [];
        return (
          <View style={[styles.message, assistant ? styles.assistantMessage : styles.userMessage]} accessibilityLabel={`${assistant ? 'Assistant' : 'You'} message`}>
            <View style={styles.messageHeader}>
              <Text style={styles.role}>{assistant ? (regenerated ? 'AI ASSISTANT · NEWER ANSWER' : 'AI ASSISTANT') : 'YOU'}</Text>
              <Text style={styles.timestamp}>{formatDisplayDateTime(item.message.createdAt)}</Text>
            </View>
            <Text selectable style={styles.content}>{item.message.content}</Text>
            {assistant && item.citations.length === 0 ? (
              <View style={styles.evidenceWarning}>
                <Ionicons name="alert-circle-outline" size={17} color={colors.pending} />
                <Text style={styles.evidenceWarningText}>
                  {props.freshInsufficientMessageIds.has(item.message.id)
                    ? 'Insufficient evidence in the selected excerpts.'
                    : 'No active saved citations. The original answer may have been insufficient or its source index may have changed.'}
                </Text>
              </View>
            ) : null}
            {item.citations.map((citation, citationIndex) => {
              const document = documentMap.get(citation.documentId);
              const caseItem = document ? caseMap.get(document.caseId) : undefined;
              return (
                <View key={citation.id} style={styles.citationWrap}>
                  <Text style={styles.citationNumber}>[{citation.citationNumber}]</Text>
                  {document && caseItem ? (
                    <SourceCitation
                      caseNumber={caseItem.caseNumber}
                      documentName={document.fileName}
                      pageStart={citation.pageStart}
                      pageEnd={citation.pageEnd}
                      onPress={() => props.onOpenCitation(item, citationIndex)}
                    />
                  ) : (
                    <View style={styles.missingCitation}><Text style={styles.missingCitationText}>Saved source is no longer available.</Text></View>
                  )}
                </View>
              );
            })}
            {warnings.map((warning, warningIndex) => <Text key={`${item.message.id}-warning-${warningIndex}`} style={styles.providerWarning}>Provider note: {warning}</Text>)}
            {assistant ? (
              <View style={styles.details}>
                <Text style={styles.adviceLabel}>AI-generated document summary · verify citations · not legal advice</Text>
                {item.message.modelName ? <Text style={styles.detailText}>Model: {item.message.modelName}</Text> : null}
                {item.message.inputTokens !== null || item.message.outputTokens !== null ? (
                  <Text style={styles.detailText}>Provider-reported usage: input {item.message.inputTokens ?? '—'} · output {item.message.outputTokens ?? '—'} tokens</Text>
                ) : null}
                <Text style={styles.restoredLabel}>Saved locally · plain text</Text>
              </View>
            ) : null}
            {assistant ? (
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" accessibilityLabel="Copy answer text" onPress={() => props.onCopyAnswer(item.message.content)} style={styles.action}>
                  <Ionicons name="copy-outline" size={17} color={colors.primary} /><Text style={styles.actionText}>Copy</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Regenerate answer using current prepared sources" accessibilityState={{ disabled: props.regenerationDisabled }} disabled={props.regenerationDisabled} onPress={() => props.onRegenerate(item.message.id)} style={[styles.action, props.regenerationDisabled && styles.disabled]}>
                  <Ionicons name="refresh-outline" size={17} color={colors.primary} /><Text style={styles.actionText}>Regenerate</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      }}
    />
  );
});

const styles = StyleSheet.create({
  list: { gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.xl },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  message: { gap: spacing.sm, maxWidth: '94%', padding: spacing.lg, borderRadius: radius.lg },
  userMessage: { alignSelf: 'flex-end', backgroundColor: colors.primarySoft },
  assistantMessage: { alignSelf: 'stretch', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface },
  messageHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  role: { ...typography.label, flex: 1, color: colors.textMuted },
  timestamp: { ...typography.caption, color: colors.textMuted },
  content: { ...typography.body, color: colors.text },
  evidenceWarning: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.pendingBackground },
  evidenceWarningText: { ...typography.caption, flex: 1, color: colors.pending },
  citationWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  citationNumber: { ...typography.bodyStrong, color: colors.primary },
  missingCitation: { flex: 1, minHeight: 48, justifyContent: 'center', padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerBackground },
  missingCitationText: { ...typography.caption, color: colors.danger },
  providerWarning: { ...typography.caption, color: colors.pending },
  details: { gap: 2, paddingTop: spacing.xs },
  adviceLabel: { ...typography.caption, fontWeight: '600', color: colors.pending },
  detailText: { ...typography.caption, color: colors.textMuted },
  restoredLabel: { ...typography.caption, color: colors.textMuted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, paddingTop: spacing.xs },
  action: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  actionText: { ...typography.caption, fontWeight: '600', color: colors.primary },
  disabled: { opacity: 0.5 },
});
