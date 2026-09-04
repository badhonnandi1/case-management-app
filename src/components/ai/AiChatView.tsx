import Ionicons from '@expo/vector-icons/Ionicons';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { AiMessageWithCitations } from '../../models/AiMessage';
import type { Case } from '../../models/Case';
import type { CaseDocument } from '../../models/CaseDocument';
import type { AiAssistantPhase } from '../../utils/aiUi';
import { aiRequestPhaseLabel, isAiRequestActive } from '../../utils/aiConversation';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';
import { AppHeader } from '../AppHeader';
import { AiConversationList } from './AiConversationList';
import { AiQuestionComposer } from './AiQuestionComposer';

interface AiChatViewProps {
  title: string;
  caseCount: number;
  documentCount: number;
  readySourceCount: number;
  backendLabel: string;
  backendAvailable: boolean;
  backendChecking: boolean;
  phase: AiAssistantPhase;
  requestMessage: string | null;
  scopeChanged: boolean;
  entries: readonly AiMessageWithCitations[];
  cases: readonly Case[];
  documents: readonly CaseDocument[];
  draft: string;
  freshInsufficientMessageIds: ReadonlySet<string>;
  warningsByMessageId: ReadonlyMap<string, readonly string[]>;
  onDraftChange: (value: string) => void;
  onSend: (question: string) => void;
  onCancel: () => void;
  onRetry: () => void;
  onRetryBackend: () => void;
  onOpenSearch: () => void;
  onChangeSources: () => void;
  onOpenMenu: () => void;
  onOpenCitation: (entry: AiMessageWithCitations, citationIndex: number) => void;
  onCopyAnswer: (content: string) => void;
  onRegenerate: (assistantMessageId: string) => void;
}

export function AiChatView(props: AiChatViewProps) {
  const active = isAiRequestActive(props.phase);
  const progress = aiRequestPhaseLabel(props.phase);
  const hasReadySources = props.readySourceCount > 0;
  const disabledReason = !hasReadySources
    ? 'Prepare or re-index at least one selected document before asking online.'
    : !props.backendAvailable
      ? props.backendLabel
      : null;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
      <AppHeader
        title={props.title}
        subtitle={`${props.caseCount} cases · ${props.documentCount} documents · ${props.readySourceCount} ready`}
        rightAction={<Pressable accessibilityRole="button" accessibilityLabel="Open thread menu" disabled={active} onPress={props.onOpenMenu} style={[styles.iconButton, active && styles.disabled]}><Ionicons name="ellipsis-vertical" size={22} color={colors.primary} /></Pressable>}
      />
      <View style={styles.contextBar}>
        <View style={styles.statusTextWrap}>
          <View style={[styles.statusDot, { backgroundColor: props.backendAvailable ? colors.active : colors.pending }]} />
          <Text style={styles.statusText}>{props.backendLabel}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Check AI backend again" disabled={props.backendChecking || active} onPress={props.onRetryBackend} style={styles.retryStatus}>
          <Text style={styles.retryStatusText}>{props.backendChecking ? 'Checking…' : 'Retry'}</Text>
        </Pressable>
      </View>
      <View style={styles.sourceActions}>
        <Pressable accessibilityRole="button" disabled={active} onPress={props.onOpenSearch} style={[styles.sourceAction, active && styles.disabled]}><Ionicons name="search-outline" size={17} color={colors.primary} /><Text style={styles.sourceActionText}>Local Search</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={active} onPress={props.onChangeSources} style={[styles.sourceAction, active && styles.disabled]}><Ionicons name="options-outline" size={17} color={colors.primary} /><Text style={styles.sourceActionText}>Sources</Text></Pressable>
      </View>
      {props.scopeChanged ? <Text accessibilityRole="alert" style={styles.scopeWarning}>Source scope changed. Older answers were generated from the earlier scope; verify their saved citations independently.</Text> : null}
      {progress ? <View accessibilityRole="progressbar" style={styles.progress}><Ionicons name="sync-outline" size={18} color={colors.primary} /><Text style={styles.progressText}>{progress}</Text></View> : null}
      {props.requestMessage ? (
        <View style={[styles.requestBanner, props.phase === 'chat_cancelled' ? styles.cancelBanner : styles.errorBanner]}>
          <Text accessibilityRole="alert" style={styles.requestText}>{props.requestMessage}</Text>
          {props.phase === 'chat_request_error' ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: props.backendChecking || !props.backendAvailable }} disabled={props.backendChecking || !props.backendAvailable} onPress={props.onRetry} style={[styles.retryButton, (props.backendChecking || !props.backendAvailable) && styles.disabled]}><Text style={styles.retryButtonText}>Retry question</Text></Pressable> : null}
        </View>
      ) : null}
      <AiConversationList
        entries={props.entries}
        cases={props.cases}
        documents={props.documents}
        freshInsufficientMessageIds={props.freshInsufficientMessageIds}
        warningsByMessageId={props.warningsByMessageId}
        regenerationDisabled={active || !hasReadySources || !props.backendAvailable}
        onOpenCitation={props.onOpenCitation}
        onCopyAnswer={props.onCopyAnswer}
        onRegenerate={props.onRegenerate}
      />
      <AiQuestionComposer
        value={props.draft}
        active={active}
        cancellable={props.phase !== 'chat_saving'}
        canSend={hasReadySources && props.backendAvailable}
        disabledReason={disabledReason}
        onChange={props.onDraftChange}
        onSend={props.onSend}
        onCancel={props.onCancel}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  contextBar: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: spacing.xl, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface },
  statusTextWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusDot: { width: 9, height: 9, borderRadius: radius.pill },
  statusText: { ...typography.caption, flex: 1, color: colors.text },
  retryStatus: { minHeight: 44, justifyContent: 'center' },
  retryStatusText: { ...typography.caption, fontWeight: '600', color: colors.primary },
  sourceActions: { flexDirection: 'row', gap: spacing.xl, paddingHorizontal: spacing.xl, backgroundColor: colors.surface },
  sourceAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  sourceActionText: { ...typography.caption, fontWeight: '600', color: colors.primary },
  scopeWarning: { ...typography.caption, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, color: colors.pending, backgroundColor: colors.pendingBackground },
  progress: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, backgroundColor: colors.primarySoft },
  progressText: { ...typography.caption, color: colors.primary },
  requestBanner: { gap: spacing.sm, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
  errorBanner: { backgroundColor: colors.dangerBackground },
  cancelBanner: { backgroundColor: colors.pendingBackground },
  requestText: { ...typography.caption, color: colors.text },
  retryButton: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center' },
  retryButtonText: { ...typography.caption, fontWeight: '600', color: colors.primary },
  disabled: { opacity: 0.5 },
});
