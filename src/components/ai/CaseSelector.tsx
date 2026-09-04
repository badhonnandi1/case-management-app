import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Case } from '../../models/Case';
import { searchCases } from '../../repositories/caseRepository';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';
import { selectFilteredIds, toggleSelectedId } from '../../utils/aiUi';
import { EmptyState } from '../EmptyState';
import { PrimaryButton } from '../PrimaryButton';
import { StatusBadge } from '../StatusBadge';

interface CaseSelectorProps {
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
  onContinue: () => void;
  onCancel: () => void;
}

export function CaseSelector({ selectedIds, onChange, onContinue, onCancel }: CaseSelectorProps) {
  const [query, setQuery] = useState('');
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const loadCases = useCallback(async (search: string) => {
    setLoading(true);
    setError(null);
    try {
      setCases(await searchCases(search));
    } catch {
      setError('Cases could not be loaded from local storage.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => void loadCases(query), 250);
    return () => clearTimeout(timeout);
  }, [loadCases, query]);

  const renderCase = useCallback(({ item }: { item: Case }) => {
    const checked = selectedIdSet.has(item.id);
    return (
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={`${item.caseTitle}, ${item.caseNumber}`}
        onPress={() => onChange(toggleSelectedId(selectedIds, item.id))}
        style={({ pressed }) => [styles.row, checked && styles.rowSelected, pressed && styles.pressed]}
      >
        <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={25} color={checked ? colors.primary : colors.textMuted} />
        <View style={styles.rowText}>
          <Text style={styles.title} numberOfLines={2}>{item.caseTitle}</Text>
          <Text style={styles.number}>{item.caseNumber}</Text>
          <Text style={styles.meta} numberOfLines={2}>{item.partyName} v. {item.oppositePartyName}</Text>
          <Text style={styles.meta} numberOfLines={1}>{item.courtName}</Text>
        </View>
        <StatusBadge status={item.status} />
      </Pressable>
    );
  }, [onChange, selectedIdSet, selectedIds]);

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Return to AI home" onPress={onCancel} style={styles.backButton}>
          <Ionicons name="arrow-back" size={22} color={colors.primary} />
        </Pressable>
        <View style={styles.headingText}>
          <Text style={styles.heading}>Select Cases</Text>
          <Text style={styles.subheading}>{selectedIds.length} selected</Text>
        </View>
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={20} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search title, number, parties, or court"
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Search cases"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.searchInput}
        />
        {query ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear case search" onPress={() => setQuery('')} hitSlop={10}>
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.selectionActions}>
        <Pressable
          accessibilityRole="button"
          disabled={cases.length === 0}
          onPress={() => onChange(selectFilteredIds(selectedIds, cases.map((item) => item.id)))}
          style={styles.textButton}
        >
          <Text style={styles.textButtonLabel}>Select all filtered ({cases.length})</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={selectedIds.length === 0} onPress={() => onChange([])} style={styles.textButton}>
          <Text style={[styles.textButtonLabel, selectedIds.length === 0 && styles.disabledText]}>Clear selection</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.state}><ActivityIndicator color={colors.primary} /><Text style={styles.stateText}>Loading cases…</Text></View>
      ) : error ? (
        <EmptyState icon="alert-circle-outline" title="Unable to load cases" message={error} actionLabel="Try again" onAction={() => void loadCases(query)} />
      ) : (
        <FlatList
          data={cases}
          renderItem={renderCase}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={[styles.list, cases.length === 0 && styles.emptyList]}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={<EmptyState icon="briefcase-outline" title={query ? 'No matching cases' : 'No cases yet'} message={query ? 'Try another title, number, party, or court.' : 'Add a case from the Cases tab before preparing sources.'} />}
        />
      )}

      <View style={styles.footer}>
        <PrimaryButton label="Continue to Documents" disabled={selectedIds.length === 0} onPress={onContinue} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.md },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  headingText: { flex: 1 },
  heading: { ...typography.heading, color: colors.text },
  subheading: { ...typography.caption, color: colors.textMuted },
  searchBox: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.xl, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  searchInput: { flex: 1, color: colors.text, ...typography.body },
  selectionActions: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  textButton: { minHeight: 44, justifyContent: 'center' },
  textButtonLabel: { ...typography.caption, fontWeight: '600', color: colors.primary },
  disabledText: { color: colors.textMuted },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  row: { minHeight: 92, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surface },
  rowSelected: { borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primarySoft },
  pressed: { opacity: 0.8 },
  rowText: { flex: 1, gap: 2 },
  title: { ...typography.bodyStrong, color: colors.text },
  number: { ...typography.caption, fontWeight: '600', color: colors.primary },
  meta: { ...typography.caption, color: colors.textMuted },
  separator: { height: spacing.sm },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  stateText: { ...typography.body, color: colors.textMuted },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xl, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surface },
});
