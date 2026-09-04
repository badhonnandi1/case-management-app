import { memo } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { AppCard } from './AppCard';
import { StatusBadge } from './StatusBadge';
import type { Case } from '../models/Case';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { formatDisplayDate } from '../utils/date';

interface CaseListItemProps {
  caseItem: Case;
  onPress?: (caseItem: Case) => void;
}

export const CaseListItem = memo(function CaseListItem({
  caseItem,
  onPress,
}: CaseListItemProps) {
  return (
    <AppCard
      accessibilityLabel={`${caseItem.caseTitle}, ${caseItem.caseNumber}`}
      onPress={onPress ? () => onPress(caseItem) : undefined}
    >
      <View style={styles.titleRow}>
        <View style={styles.titleContainer}>
          <Text style={styles.title} numberOfLines={2}>
            {caseItem.caseTitle}
          </Text>
          <Text style={styles.caseNumber}>{caseItem.caseNumber}</Text>
        </View>
        <StatusBadge status={caseItem.status} />
      </View>
      <View style={styles.detailRow}>
        <Ionicons name="business-outline" size={16} color={colors.textMuted} />
        <Text style={styles.detailText} numberOfLines={1}>
          {caseItem.courtName}
        </Text>
      </View>
      <View style={styles.hearingRow}>
        <View>
          <Text style={styles.hearingLabel}>NEXT HEARING</Text>
          <Text style={styles.hearingDate}>{formatDisplayDate(caseItem.nextDate)}</Text>
        </View>
        {onPress ? (
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        ) : null}
      </View>
    </AppCard>
  );
});

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  titleContainer: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    ...typography.subheading,
    color: colors.text,
  },
  caseNumber: {
    ...typography.caption,
    color: colors.textMuted,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  detailText: {
    ...typography.body,
    flex: 1,
    color: colors.textMuted,
  },
  hearingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  hearingLabel: {
    ...typography.label,
    marginBottom: spacing.xs,
    color: colors.textMuted,
  },
  hearingDate: {
    ...typography.bodyStrong,
    color: colors.primary,
  },
});
