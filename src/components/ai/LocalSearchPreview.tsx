import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { AiSearchResult } from '../../models/AiChunk';
import type { Case } from '../../models/Case';
import { retrieveLocalContext } from '../../services/aiRetrievalService';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';
import { createSearchExcerpt } from '../../utils/aiUi';
import { EmptyState } from '../EmptyState';
import { PrimaryButton } from '../PrimaryButton';
import { SourceCitation } from './SourceCitation';

interface LocalSearchPreviewProps {
  caseIds: readonly string[];
  documentIds: readonly string[];
  cases: readonly Case[];
  onBack: () => void;
  onOpenCitation: (result: AiSearchResult) => void;
}

export function LocalSearchPreview(props: LocalSearchPreviewProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AiSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const caseMap = useMemo(() => new Map(props.cases.map((caseItem) => [caseItem.id, caseItem])), [props.cases]);

  async function search() {
    const normalized = query.trim();
    if (!normalized) {
      setError('Enter a Bangla or English search term.');
      return;
    }
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const found = await retrieveLocalContext(normalized, {
        caseIds: props.caseIds,
        documentIds: props.documentIds,
      });
      setResults(found);
      setSearched(true);
    } catch (searchError) {
      const message = searchError instanceof Error ? searchError.message.toLowerCase() : '';
      setResults([]);
      setSearched(true);
      setError(message.includes('fts') || message.includes('no such table')
        ? 'Local full-text search is unavailable on this device.'
        : message.includes('select at least')
          ? 'This session has no valid selected sources. Change sources and try again.'
          : 'The prepared sources could not be searched. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Return to prepared sources" onPress={props.onBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={22} color={colors.primary} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.heading}>Search Prepared Sources</Text>
          <Text style={styles.subtitle}>This searches extracted text locally. Results are document excerpts, not an AI-generated answer.</Text>
        </View>
      </View>

      <View style={styles.searchArea}>
        <View style={[styles.searchBox, error && styles.searchBoxError]}>
          <Ionicons name="search-outline" size={20} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={(value) => { setQuery(value); if (error) setError(null); }}
            placeholder="Search Bangla or English text"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Search prepared source text"
            returnKeyType="search"
            onSubmitEditing={() => void search()}
            style={styles.input}
          />
        </View>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <PrimaryButton label="Search Locally" loading={loading} disabled={loading} onPress={() => void search()} />
      </View>

      {loading ? (
        <View style={styles.state}><ActivityIndicator color={colors.primary} /><Text style={styles.stateText}>Searching prepared text on this device…</Text></View>
      ) : searched && results.length === 0 && !error ? (
        <EmptyState icon="search-outline" title="No local matches" message="Try different words or change the selected documents." />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.chunkId}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.results}
          renderItem={({ item, index }) => {
            const caseNumber = caseMap.get(item.caseId)?.caseNumber ?? 'Case unavailable';
            return (
              <View style={styles.resultCard}>
                <View style={styles.resultHeader}>
                  <Text style={styles.resultLabel}>LOCAL SEARCH RESULT {index + 1}</Text>
                  <Ionicons name="phone-portrait-outline" size={16} color={colors.textMuted} />
                </View>
                <Text style={styles.excerpt}>{createSearchExcerpt(item.content)}</Text>
                <SourceCitation
                  caseNumber={caseNumber}
                  documentName={item.documentName}
                  pageStart={item.pageStart}
                  pageEnd={item.pageEnd}
                  onPress={() => props.onOpenCitation(item)}
                />
              </View>
            );
          }}
          ListEmptyComponent={!searched ? <EmptyState icon="search-outline" title="Search your prepared sources" message="Enter words from an order, petition, notice, or other digital PDF." /> : null}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.xl, paddingBottom: spacing.md },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  headerText: { flex: 1, gap: spacing.xs },
  heading: { ...typography.heading, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textMuted },
  searchArea: { gap: spacing.sm, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  searchBox: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  searchBoxError: { borderColor: colors.danger },
  input: { flex: 1, color: colors.text, ...typography.body },
  error: { ...typography.caption, color: colors.danger },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  stateText: { ...typography.body, color: colors.textMuted },
  results: { gap: spacing.md, paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  resultCard: { gap: spacing.md, padding: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  resultHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resultLabel: { ...typography.label, color: colors.textMuted },
  excerpt: { ...typography.body, color: colors.text },
});
