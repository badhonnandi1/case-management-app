import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppCard } from '../components/AppCard';
import { AppHeader } from '../components/AppHeader';
import { CaseListItem } from '../components/CaseListItem';
import { EmptyState } from '../components/EmptyState';
import { SectionTitle } from '../components/SectionTitle';
import type { Case, CaseCounts } from '../models/Case';
import type { HomeScreenProps } from '../navigation/types';
import {
  getCaseCounts,
  getRecentlyUpdatedCases,
  getUpcomingCases,
} from '../repositories/caseRepository';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { formatDisplayDate } from '../utils/date';

interface DashboardData {
  counts: CaseCounts;
  upcoming: Case[];
  recent: Case[];
}

const initialDashboardData: DashboardData = {
  counts: { today: 0, upcoming: 0, active: 0, total: 0 },
  upcoming: [],
  recent: [],
};

export function HomeScreen({ navigation }: HomeScreenProps) {
  const [data, setData] = useState<DashboardData>(initialDashboardData);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const [counts, upcoming, recent] = await Promise.all([
        getCaseCounts(),
        getUpcomingCases(3),
        getRecentlyUpdatedCases(3),
      ]);
      setData({ counts, upcoming, recent });
    } catch (loadError) {
      console.error('Unable to load dashboard data.', loadError);
      setError('Your case summary could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadDashboard();
    }, [loadDashboard]),
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <AppHeader title="Case Management" subtitle="Your legal practice at a glance" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading case summary…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <AppHeader title="Case Management" subtitle="Your legal practice at a glance" />
        <EmptyState
          icon="alert-circle-outline"
          title="Unable to load dashboard"
          message={error}
          actionLabel="Try again"
          onAction={() => void loadDashboard()}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadDashboard(true)}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        <AppHeader title="Case Management" subtitle="Your legal practice at a glance" />

        <View style={styles.summaryGrid}>
          <SummaryCard
            label="Today's Hearings"
            value={data.counts.today}
            icon="today-outline"
          />
          <SummaryCard
            label="Upcoming Cases"
            value={data.counts.upcoming}
            icon="calendar-outline"
          />
          <SummaryCard label="Active Cases" value={data.counts.active} icon="briefcase-outline" />
          <SummaryCard label="Total Cases" value={data.counts.total} icon="folder-outline" />
        </View>

        <View style={styles.section}>
          <SectionTitle title="Upcoming Hearings" caption="Next 3" />
          {data.upcoming.length > 0 ? (
            <View style={styles.cardList}>
              {data.upcoming.map((caseItem) => (
                <CaseListItem
                  key={caseItem.id}
                  caseItem={caseItem}
                  onPress={(selectedCase) =>
                    navigation.navigate('CaseDetails', { caseId: selectedCase.id })
                  }
                />
              ))}
            </View>
          ) : (
            <EmptyState
              icon="calendar-clear-outline"
              title="No upcoming hearings"
              message="Future hearing dates will appear here once cases are scheduled."
            />
          )}
        </View>

        <View style={styles.section}>
          <SectionTitle title="Recently Updated" />
          {data.recent.length > 0 ? (
            <AppCard style={styles.recentCard}>
              {data.recent.map((caseItem, index) => (
                <Pressable
                  key={caseItem.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${caseItem.caseTitle}`}
                  onPress={() =>
                    navigation.navigate('CaseDetails', { caseId: caseItem.id })
                  }
                  style={({ pressed }) => [
                    styles.recentRow,
                    index > 0 && styles.recentDivider,
                    pressed && styles.recentPressed,
                  ]}
                >
                  <View style={styles.recentIcon}>
                    <Ionicons name="document-text-outline" size={18} color={colors.primary} />
                  </View>
                  <View style={styles.recentText}>
                    <Text style={styles.recentTitle} numberOfLines={1}>
                      {caseItem.caseTitle}
                    </Text>
                    <Text style={styles.recentMeta} numberOfLines={1}>
                      {caseItem.caseNumber} · {formatDisplayDate(caseItem.updatedAt)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </Pressable>
              ))}
            </AppCard>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

interface SummaryCardProps {
  label: string;
  value: number;
  icon: keyof typeof Ionicons.glyphMap;
}

function SummaryCard({ label, value, icon }: SummaryCardProps) {
  return (
    <AppCard style={styles.summaryCard}>
      <View style={styles.summaryIcon}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: spacing.xxl,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingText: {
    ...typography.body,
    color: colors.textMuted,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  summaryCard: {
    width: '48%',
    minHeight: 140,
  },
  summaryIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  summaryValue: {
    ...typography.display,
    marginTop: spacing.md,
    color: colors.text,
  },
  summaryLabel: {
    ...typography.caption,
    marginTop: spacing.xs,
    color: colors.textMuted,
  },
  section: {
    gap: spacing.md,
    marginTop: spacing.xxl,
    paddingHorizontal: spacing.xl,
  },
  cardList: {
    gap: spacing.md,
  },
  recentCard: {
    paddingVertical: 0,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  recentDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  recentPressed: {
    opacity: 0.72,
  },
  recentIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  recentText: {
    flex: 1,
    gap: spacing.xs,
  },
  recentTitle: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  recentMeta: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
