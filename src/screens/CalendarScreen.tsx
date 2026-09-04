import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppCard } from '../components/AppCard';
import { AppHeader } from '../components/AppHeader';
import { CaseListItem } from '../components/CaseListItem';
import { EmptyState } from '../components/EmptyState';
import { PrimaryButton } from '../components/PrimaryButton';
import { SectionTitle } from '../components/SectionTitle';
import type { Case } from '../models/Case';
import type { CalendarScreenProps } from '../navigation/types';
import { getCasesBetweenDates, getCasesByHearingDate } from '../repositories/caseRepository';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { formatDisplayDate, formatMonthTitle, getMonthDateRange, toLocalDateString } from '../utils/date';

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

interface CalendarCell {
  key: string;
  day: number | null;
  date: string | null;
}

export function CalendarScreen({ navigation }: CalendarScreenProps) {
  const today = toLocalDateString();
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const initialMonth = new Date();
    initialMonth.setDate(1);
    return initialMonth;
  });
  const [selectedDate, setSelectedDate] = useState(() => toLocalDateString());
  const [monthCases, setMonthCases] = useState<Case[]>([]);
  const [selectedCases, setSelectedCases] = useState<Case[]>([]);
  const [monthLoading, setMonthLoading] = useState(true);
  const [selectedLoading, setSelectedLoading] = useState(true);
  const [monthError, setMonthError] = useState<string | null>(null);
  const [selectedError, setSelectedError] = useState<string | null>(null);
  const year = visibleMonth.getFullYear();
  const monthIndex = visibleMonth.getMonth();

  const loadMonth = useCallback(async () => {
    setMonthLoading(true);
    setMonthError(null);
    try {
      const { startDate, endDate } = getMonthDateRange(year, monthIndex);
      setMonthCases(await getCasesBetweenDates(startDate, endDate));
    } catch (error) {
      console.error('Unable to load hearing month.', error);
      setMonthError('Hearing dates for this month could not be loaded.');
    } finally {
      setMonthLoading(false);
    }
  }, [monthIndex, year]);

  const loadSelectedDate = useCallback(async () => {
    setSelectedLoading(true);
    setSelectedError(null);
    setSelectedCases([]);
    try {
      setSelectedCases(await getCasesByHearingDate(selectedDate));
    } catch (error) {
      console.error('Unable to load hearings for selected date.', error);
      setSelectedError('Hearings for this date could not be loaded.');
    } finally {
      setSelectedLoading(false);
    }
  }, [selectedDate]);

  useFocusEffect(useCallback(() => { void loadMonth(); }, [loadMonth]));
  useFocusEffect(useCallback(() => { void loadSelectedDate(); }, [loadSelectedDate]));

  const cells = useMemo(() => createCalendarCells(year, monthIndex), [monthIndex, year]);
  const hearingCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const caseItem of monthCases) {
      if (caseItem.nextDate) counts.set(caseItem.nextDate, (counts.get(caseItem.nextDate) ?? 0) + 1);
    }
    return counts;
  }, [monthCases]);

  function changeMonth(offset: number) {
    const nextMonth = new Date(year, monthIndex + offset, 1);
    setVisibleMonth(nextMonth);
    setSelectedDate(toLocalDateString(nextMonth));
  }

  const countLabel = `${selectedCases.length} ${selectedCases.length === 1 ? 'Case' : 'Cases'}`;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <AppHeader title="Hearing Calendar" subtitle="Current scheduled court hearings" />
      <FlatList
        data={selectedCases}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <CaseListItem caseItem={item} onPress={() => navigation.navigate('CaseDetails', { caseId: item.id })} />
        )}
        ItemSeparatorComponent={() => <View style={styles.listSeparator} />}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <>
            <AppCard style={styles.calendarCard}>
              <View style={styles.monthHeader}>
                <MonthButton label="Previous month" icon="chevron-back" onPress={() => changeMonth(-1)} />
                <Text style={styles.monthTitle}>{formatMonthTitle(visibleMonth)}</Text>
                <MonthButton label="Next month" icon="chevron-forward" onPress={() => changeMonth(1)} />
              </View>

              {monthLoading ? (
                <View style={styles.calendarState}><ActivityIndicator color={colors.primary} /><Text style={styles.stateText}>Loading hearings…</Text></View>
              ) : monthError ? (
                <View style={styles.calendarState}>
                  <Ionicons name="alert-circle-outline" size={26} color={colors.danger} />
                  <Text style={styles.calendarError}>{monthError}</Text>
                  <Pressable accessibilityRole="button" onPress={() => void loadMonth()} style={styles.retryButton}><Text style={styles.retryText}>Try again</Text></Pressable>
                </View>
              ) : (
                <>
                  <View style={styles.weekdayRow}>
                    {WEEKDAYS.map((weekday) => <Text key={weekday} style={styles.weekday}>{weekday}</Text>)}
                  </View>
                  <View style={styles.calendarGrid}>
                    {cells.map((cell) => {
                      const cellDate = cell.date;
                      const count = cellDate ? hearingCounts.get(cellDate) ?? 0 : 0;
                      const selected = cellDate === selectedDate;
                      const isToday = cellDate === today;
                      return (
                        <View key={cell.key} style={styles.cellWrapper}>
                          {cellDate && cell.day ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`${formatDisplayDate(cellDate)}, ${count} scheduled ${count === 1 ? 'case' : 'cases'}`}
                              accessibilityState={{ selected }}
                              onPress={() => setSelectedDate(cellDate)}
                              style={({ pressed }) => [styles.dayCell, selected && styles.selectedCell, isToday && !selected && styles.todayCell, pressed && styles.dayPressed]}
                            >
                              <Text style={[styles.dayNumber, selected && styles.selectedText, isToday && !selected && styles.todayText]}>{cell.day}</Text>
                              {count > 0 ? <View style={[styles.countBadge, selected && styles.selectedCountBadge]}><Text style={[styles.countText, selected && styles.selectedCountText]}>{count}</Text></View> : <View style={styles.countPlaceholder} />}
                            </Pressable>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                </>
              )}
            </AppCard>

            <View style={styles.selectedHeader}>
              <SectionTitle title={formatDisplayDate(selectedDate)} caption={!selectedLoading && !selectedError ? countLabel : undefined} />
            </View>
            {!selectedLoading && !selectedError && selectedCases.length > 0 ? (
              <View style={styles.causeListAction}>
                <PrimaryButton
                  label="Generate Cause List"
                  onPress={() => navigation.navigate('CauseListGenerator', { selectedDate })}
                />
              </View>
            ) : null}
            {selectedLoading ? <View style={styles.listLoading}><ActivityIndicator color={colors.primary} /><Text style={styles.stateText}>Loading scheduled cases…</Text></View> : null}
          </>
        }
        ListEmptyComponent={
          selectedLoading ? null : selectedError ? (
            <EmptyState icon="alert-circle-outline" title="Unable to load hearings" message={selectedError} actionLabel="Try again" onAction={() => void loadSelectedDate()} />
          ) : (
            <EmptyState icon="calendar-clear-outline" title="No Hearings Scheduled" message="There are no cases scheduled for this date." />
          )
        }
      />
    </SafeAreaView>
  );
}

function MonthButton({ label, icon, onPress }: { label: string; icon: 'chevron-back' | 'chevron-forward'; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.monthButton, pressed && styles.monthButtonPressed]}><Ionicons name={icon} size={22} color={colors.primary} /></Pressable>;
}

function createCalendarCells(year: number, monthIndex: number): CalendarCell[] {
  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day >= 1 && day <= daysInMonth
      ? { key: toLocalDateString(new Date(year, monthIndex, day)), day, date: toLocalDateString(new Date(year, monthIndex, day)) }
      : { key: `empty-${index}`, day: null, date: null };
  });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  calendarCard: { padding: spacing.md },
  monthHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  monthButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  monthButtonPressed: { backgroundColor: colors.primarySoft },
  monthTitle: { ...typography.subheading, color: colors.text },
  weekdayRow: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  weekday: { ...typography.label, width: '14.2857%', paddingVertical: spacing.sm, textAlign: 'center', fontSize: 10, color: colors.textMuted },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingTop: spacing.sm },
  cellWrapper: { width: '14.2857%', padding: 2 },
  dayCell: { minHeight: 49, alignItems: 'center', justifyContent: 'center', gap: 3, borderWidth: 1, borderColor: 'transparent', borderRadius: radius.sm },
  selectedCell: { backgroundColor: colors.primary },
  todayCell: { borderColor: colors.primary },
  dayPressed: { opacity: 0.72 },
  dayNumber: { ...typography.body, color: colors.text },
  selectedText: { color: colors.surface, fontWeight: '700' },
  todayText: { color: colors.primary, fontWeight: '700' },
  countBadge: { minWidth: 18, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  selectedCountBadge: { backgroundColor: colors.surface },
  countText: { fontSize: 10, lineHeight: 13, fontWeight: '700', color: colors.primary },
  selectedCountText: { color: colors.primary },
  countPlaceholder: { height: 16 },
  calendarState: { minHeight: 320, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  calendarError: { ...typography.body, textAlign: 'center', color: colors.textMuted },
  retryButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  retryText: { ...typography.bodyStrong, color: colors.primary },
  selectedHeader: { marginTop: spacing.xxl, marginBottom: spacing.lg },
  causeListAction: { marginBottom: spacing.lg },
  listLoading: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingVertical: spacing.xxxl },
  stateText: { ...typography.body, color: colors.textMuted },
  listSeparator: { height: spacing.md },
});
