import Ionicons from '@expo/vector-icons/Ionicons';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import type { AiPreparationItem } from '../../models/AiUi';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';
import { retryableDocumentIds, summarizePreparation } from '../../utils/aiUi';
import { PrimaryButton } from '../PrimaryButton';

interface IndexingProgressProps {
  items: readonly AiPreparationItem[];
  activeIndex: number;
  running: boolean;
  onCancel: () => void;
  onRetry: (documentIds: string[]) => void;
  onContinue: () => void;
  onChangeSources: () => void;
}

export function IndexingProgress(props: IndexingProgressProps) {
  const summary = summarizePreparation(props.items);
  const retryable = retryableDocumentIds(props.items);
  const completed = props.items.filter((item) => item.status !== 'queued' && item.status !== 'preparing').length;
  const active = props.items[props.activeIndex];
  const pageFraction = active?.status === 'preparing' && active.pageCount
    ? Math.min(1, active.completedPages / active.pageCount)
    : 0;
  const fraction = props.items.length === 0 ? 0 : Math.min(1, (completed + pageFraction) / props.items.length);
  const usableCount = summary.ready + summary.reused;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.heading}>{props.running ? 'Preparing Sources' : 'Preparation Complete'}</Text>
        <Text style={styles.subtitle}>
          {props.running && active
            ? `${active.documentName} · ${props.activeIndex + 1} of ${props.items.length}`
            : `${completed} of ${props.items.length} documents processed`}
        </Text>
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }} style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(fraction * 100)}%` }]} />
        </View>
        <Text style={styles.progressText}>{Math.round(fraction * 100)}% overall</Text>
      </View>

      <FlatList
        data={[...props.items]}
        keyExtractor={(item) => item.documentId}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => (
          <View style={[styles.item, index === props.activeIndex && props.running && styles.activeItem]}>
            <Ionicons name={itemIcon(item.status)} size={22} color={itemColor(item.status)} />
            <View style={styles.itemText}>
              <Text style={styles.itemName} numberOfLines={2}>{item.documentName}</Text>
              <Text style={[styles.itemStatus, { color: itemColor(item.status) }]}>{itemStatusText(item)}</Text>
              {item.message ? <Text style={styles.itemMessage}>{item.message}</Text> : null}
            </View>
          </View>
        )}
      />

      <View style={styles.summary}>
        <Summary label="Ready" value={summary.ready} />
        <Summary label="Reused" value={summary.reused} />
        <Summary label="Requires OCR" value={summary.requiresOcr} />
        <Summary label="Failed" value={summary.failed + summary.cancelled} />
        <Summary label="Missing" value={summary.missing} />
      </View>

      <View style={styles.footer}>
        {props.running ? (
          <SecondaryButton icon="close-circle-outline" label="Cancel Preparation" danger onPress={props.onCancel} />
        ) : (
          <>
            {retryable.length > 0 ? <SecondaryButton icon="refresh-outline" label={`Retry Failed (${retryable.length})`} onPress={() => props.onRetry(retryable)} /> : null}
            <SecondaryButton icon="options-outline" label="Change Sources" onPress={props.onChangeSources} />
            <PrimaryButton label="Continue with Ready Sources" disabled={usableCount === 0} onPress={props.onContinue} />
          </>
        )}
      </View>
    </View>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return <View style={styles.summaryItem}><Text style={styles.summaryValue}>{value}</Text><Text style={styles.summaryLabel}>{label}</Text></View>;
}

function SecondaryButton({ icon, label, onPress, danger = false }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.secondaryButton, danger && styles.dangerButton, pressed && styles.pressed]}>
      <Ionicons name={icon} size={19} color={danger ? colors.danger : colors.primary} />
      <Text style={[styles.secondaryLabel, danger && styles.dangerLabel]}>{label}</Text>
    </Pressable>
  );
}

function itemStatusText(item: AiPreparationItem): string {
  if (item.status === 'preparing') {
    const stage = item.stage ? `${item.stage.charAt(0).toUpperCase()}${item.stage.slice(1)}` : 'Preparing';
    return item.pageCount ? `${stage} · ${item.completedPages}/${item.pageCount} pages` : stage;
  }
  const labels: Record<AiPreparationItem['status'], string> = {
    queued: 'Waiting', preparing: 'Preparing', ready: 'Ready', reused: 'Reused unchanged index',
    requires_ocr: 'Requires OCR', missing: 'Missing file', unsupported: 'Unsupported',
    failed: 'Failed', cancelled: 'Cancelled — retry available',
  };
  return labels[item.status];
}

function itemColor(status: AiPreparationItem['status']): string {
  if (status === 'ready' || status === 'reused') return colors.active;
  if (status === 'failed' || status === 'missing' || status === 'unsupported') return colors.danger;
  if (status === 'requires_ocr' || status === 'cancelled') return colors.pending;
  return colors.primary;
}

function itemIcon(status: AiPreparationItem['status']): keyof typeof Ionicons.glyphMap {
  if (status === 'ready' || status === 'reused') return 'checkmark-circle';
  if (status === 'preparing') return 'sync-outline';
  if (status === 'requires_ocr') return 'scan-outline';
  if (status === 'missing') return 'cloud-offline-outline';
  if (status === 'failed' || status === 'unsupported') return 'alert-circle-outline';
  if (status === 'cancelled') return 'pause-circle-outline';
  return 'time-outline';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { gap: spacing.sm, padding: spacing.xl },
  heading: { ...typography.heading, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted },
  progressTrack: { height: 9, overflow: 'hidden', borderRadius: radius.pill, backgroundColor: colors.border },
  progressFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.primary },
  progressText: { ...typography.caption, color: colors.textMuted },
  list: { gap: spacing.sm, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  item: { minHeight: 72, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  activeItem: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  itemText: { flex: 1, gap: 2 },
  itemName: { ...typography.bodyStrong, color: colors.text },
  itemStatus: { ...typography.caption, fontWeight: '600' },
  itemMessage: { ...typography.caption, color: colors.textMuted },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  summaryItem: { minWidth: 92, flexGrow: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface },
  summaryValue: { ...typography.subheading, color: colors.text },
  summaryLabel: { ...typography.caption, color: colors.textMuted },
  footer: { gap: spacing.sm, paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xl, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surface },
  secondaryButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  dangerButton: { borderColor: colors.danger },
  secondaryLabel: { ...typography.bodyStrong, color: colors.primary },
  dangerLabel: { color: colors.danger },
  pressed: { opacity: 0.75 },
});
