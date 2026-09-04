import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppHeader } from '../components/AppHeader';
import { CaseListItem } from '../components/CaseListItem';
import { EmptyState } from '../components/EmptyState';
import type { Case, CaseListFilter, CaseSortOption } from '../models/Case';
import type { CasesScreenProps } from '../navigation/types';
import { getCases, getTotalCaseCount } from '../repositories/caseRepository';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

const filters: readonly { value: CaseListFilter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'TODAY', label: 'Today' },
  { value: 'UPCOMING', label: 'Upcoming' },
];

const sortOptions: readonly { value: CaseSortOption; label: string }[] = [
  { value: 'NEXT_HEARING', label: 'Next Hearing — Earliest First' },
  { value: 'RECENTLY_UPDATED', label: 'Recently Updated' },
  { value: 'TITLE_ASC', label: 'Case Title A-Z' },
];

export function CasesScreen({ navigation }: CasesScreenProps) {
  const [cases, setCases] = useState<Case[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filter, setFilter] = useState<CaseListFilter>('ALL');
  const [sort, setSort] = useState<CaseSortOption>('NEXT_HEARING');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const loadCases = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const [caseResults, count] = await Promise.all([
          getCases({ search: debouncedQuery, filter, sort }),
          getTotalCaseCount(),
        ]);
        setCases(caseResults);
        setTotalCount(count);
      } catch (loadError) {
        console.error('Unable to load cases.', loadError);
        setError('Your saved cases could not be loaded.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [debouncedQuery, filter, sort],
  );

  useFocusEffect(
    useCallback(() => {
      void loadCases();
    }, [loadCases]),
  );

  const currentSortLabel =
    sortOptions.find((option) => option.value === sort)?.label ??
    'Next Hearing — Earliest First';

  function cycleSort() {
    const currentIndex = sortOptions.findIndex((option) => option.value === sort);
    const nextOption = sortOptions[(currentIndex + 1) % sortOptions.length];
    if (nextOption) {
      setSort(nextOption.value);
    }
  }

  function openCase(caseItem: Case) {
    navigation.navigate('CaseDetails', { caseId: caseItem.id });
  }

  function openAddCase() {
    navigation.navigate('AddCase');
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <AppHeader
        title="Cases"
        subtitle={`${totalCount} case${totalCount === 1 ? '' : 's'} on file`}
        rightAction={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add case"
            onPress={openAddCase}
            style={({ pressed }) => [styles.addButton, pressed && styles.controlPressed]}
          >
            <Ionicons name="add" size={20} color={colors.surface} />
            <Text style={styles.addButtonText}>Add</Text>
          </Pressable>
        }
      />

      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={20} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search cases, parties, or courts"
          placeholderTextColor={colors.textMuted}
          returnKeyType="search"
          autoCorrect={false}
          style={styles.searchInput}
          accessibilityLabel="Search cases"
        />
        {query.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={8}
            onPress={() => setQuery('')}
          >
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.controls}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterContent}
        >
          {filters.map((option) => {
            const selected = option.value === filter;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setFilter(option.value)}
                style={({ pressed }) => [
                  styles.filterChip,
                  selected && styles.filterChipSelected,
                  pressed && styles.controlPressed,
                ]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    selected && styles.filterChipTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Sort by ${currentSortLabel}. Tap to change.`}
          onPress={cycleSort}
          style={({ pressed }) => [styles.sortControl, pressed && styles.controlPressed]}
        >
          <Ionicons name="swap-vertical-outline" size={17} color={colors.primary} />
          <Text style={styles.sortText} numberOfLines={1}>
            {currentSortLabel}
          </Text>
          <Text style={styles.sortHint}>Tap to change</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading cases…</Text>
        </View>
      ) : error ? (
        <EmptyState
          icon="alert-circle-outline"
          title="Unable to load cases"
          message={error}
          actionLabel="Try again"
          onAction={() => void loadCases()}
        />
      ) : (
        <FlatList
          data={cases}
          keyExtractor={(caseItem) => caseItem.id}
          renderItem={({ item }) => <CaseListItem caseItem={item} onPress={openCase} />}
          contentContainerStyle={[
            styles.listContent,
            cases.length === 0 && styles.emptyListContent,
          ]}
          ItemSeparatorComponent={ListSeparator}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadCases(true)}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon={
                totalCount === 0
                  ? 'briefcase-outline'
                  : debouncedQuery
                    ? 'search-outline'
                    : 'filter-outline'
              }
              title={
                totalCount === 0
                  ? 'No Cases Yet'
                  : debouncedQuery
                    ? 'No matching cases found'
                    : 'No cases match this filter'
              }
              message={
                totalCount === 0
                  ? 'Add your first case to start managing your cases and hearing dates.'
                  : debouncedQuery
                    ? 'Try another case title, number, party, or court.'
                    : 'Choose another status or hearing-date filter.'
              }
              actionLabel={totalCount === 0 ? 'Add Case' : undefined}
              onAction={totalCount === 0 ? openAddCase : undefined}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

function ListSeparator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  addButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  addButtonText: {
    ...typography.bodyStrong,
    color: colors.surface,
  },
  searchContainer: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  searchInput: {
    ...typography.body,
    flex: 1,
    paddingVertical: spacing.md,
    color: colors.text,
  },
  controls: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  filterContent: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  filterChip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  filterChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  filterChipText: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.textMuted,
  },
  filterChipTextSelected: {
    color: colors.primary,
  },
  sortControl: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  sortText: {
    ...typography.caption,
    flex: 1,
    fontWeight: '600',
    color: colors.text,
  },
  sortHint: {
    ...typography.caption,
    color: colors.textMuted,
  },
  controlPressed: {
    opacity: 0.78,
  },
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  separator: {
    height: spacing.md,
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
});
