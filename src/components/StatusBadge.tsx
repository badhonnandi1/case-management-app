import { StyleSheet, Text, View } from 'react-native';

import type { CaseStatus } from '../models/Case';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

interface StatusBadgeProps {
  status: CaseStatus;
}

const statusStyles: Record<CaseStatus, { backgroundColor: string; color: string }> = {
  ACTIVE: {
    backgroundColor: colors.activeBackground,
    color: colors.active,
  },
  PENDING: {
    backgroundColor: colors.pendingBackground,
    color: colors.pending,
  },
  CLOSED: {
    backgroundColor: colors.closedBackground,
    color: colors.closed,
  },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const palette = statusStyles[status];

  return (
    <View style={[styles.badge, { backgroundColor: palette.backgroundColor }]}>
      <Text style={[styles.label, { color: palette.color }]}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  label: {
    ...typography.label,
    fontSize: 10,
  },
});
