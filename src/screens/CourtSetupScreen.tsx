import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppCard } from '../components/AppCard';
import { CourtEditorModal } from '../components/CourtEditorModal';
import { EmptyState } from '../components/EmptyState';
import type { Court } from '../models/Court';
import type { CourtSetupScreenProps } from '../navigation/types';
import { CourtInUseError, deleteCourt, getCourts } from '../repositories/courtRepository';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

export function CourtSetupScreen({}: CourtSetupScreenProps) {
  const [courts, setCourts] = useState<Court[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Court | null | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    try { setCourts(await getCourts(search)); }
    catch (error) { console.error('Unable to load courts.', error); Alert.alert('Unable to load courts', 'Saved courts could not be loaded.'); }
    finally { setLoading(false); }
  }, [search]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function confirmDelete(court: Court) {
    Alert.alert('Delete Court?', `${court.fullName} (${court.shortCode}) will be removed only if no case uses it.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void remove(court) },
    ]);
  }

  async function remove(court: Court) {
    try { await deleteCourt(court.id); await load(); }
    catch (error) {
      if (error instanceof CourtInUseError) Alert.alert('Court is in use', `Update the ${error.caseCount} linked case${error.caseCount === 1 ? '' : 's'} before deleting this court.`);
      else Alert.alert('Unable to delete court', 'No cases were changed. Please try again.');
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <View style={styles.top}>
        <TextInput value={search} onChangeText={setSearch} placeholder="Search saved courts" placeholderTextColor={colors.textMuted} accessibilityLabel="Search saved courts" style={styles.search} />
        <Pressable accessibilityRole="button" accessibilityLabel="Add new court" onPress={() => setEditing(null)} style={styles.add}><Ionicons name="add" size={20} color={colors.surface} /><Text style={styles.addText}>Add Court</Text></Pressable>
      </View>
      {loading ? <ActivityIndicator style={styles.loading} size="large" color={colors.primary} /> : (
        <FlatList data={courts} keyExtractor={(item) => item.id} contentContainerStyle={courts.length ? styles.list : styles.emptyList} ListEmptyComponent={<EmptyState icon="business-outline" title="No Courts Saved" message="Add a court once, then select it from case forms." actionLabel="Add Court" onAction={() => setEditing(null)} />} renderItem={({ item }) => (
          <AppCard style={styles.card}>
            <View style={styles.courtText}><Text style={styles.name}>{item.fullName}</Text><Text style={styles.code}>Short code: {item.shortCode}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${item.fullName}`} onPress={() => setEditing(item)} hitSlop={8} style={styles.iconButton}><Ionicons name="create-outline" size={21} color={colors.primary} /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${item.fullName}`} onPress={() => confirmDelete(item)} hitSlop={8} style={styles.iconButton}><Ionicons name="trash-outline" size={21} color={colors.danger} /></Pressable>
          </AppCard>
        )} />
      )}
      <CourtEditorModal visible={editing !== undefined} court={editing ?? null} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); void load(); }} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, top: { gap: spacing.md, padding: spacing.xl, backgroundColor: colors.surface },
  search: { minHeight: 48, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, color: colors.text, ...typography.body },
  add: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primary }, addText: { ...typography.bodyStrong, color: colors.surface },
  loading: { marginTop: spacing.xxxl }, list: { gap: spacing.md, padding: spacing.xl, paddingBottom: spacing.xxxl }, emptyList: { flexGrow: 1 },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, courtText: { flex: 1, gap: spacing.xs }, name: { ...typography.bodyStrong, color: colors.text }, code: { ...typography.caption, color: colors.textMuted },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
