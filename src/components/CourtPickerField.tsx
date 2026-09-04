import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Court } from '../models/Court';
import { courtDisplayName, getCourts } from '../repositories/courtRepository';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { CourtEditorModal } from './CourtEditorModal';

export function CourtPickerField({ selectedCourtId, legacyCourtName, error, onSelect }: {
  selectedCourtId: string;
  legacyCourtName: string;
  error?: string;
  onSelect: (court: Court) => void;
}) {
  const [courts, setCourts] = useState<Court[]>([]);
  const [visible, setVisible] = useState(false);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (query = '') => {
    setLoading(true);
    setLoadError(null);
    try { setCourts(await getCourts(query)); }
    catch (error) { console.error('Unable to load courts.', error); setLoadError('Saved courts could not be loaded.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (visible) void load(search); }, [load, visible, search]);
  const selected = courts.find((court) => court.id === selectedCourtId);
  const label = selected ? courtDisplayName(selected) : legacyCourtName.trim();

  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>Court Name <Text style={styles.required}>*</Text></Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Add new court" onPress={() => setAdding(true)} style={styles.addButton}>
          <Ionicons name="add" size={18} color={colors.primary} /><Text style={styles.addText}>Add New Court</Text>
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Select court" onPress={() => setVisible(true)} style={[styles.selector, error && styles.selectorError]}>
        <Text style={[styles.selectorText, !label && styles.placeholder]} numberOfLines={2}>{label || 'Select a saved court'}</Text>
        <Ionicons name="chevron-down" size={20} color={colors.textMuted} />
      </Pressable>
      {!selectedCourtId && legacyCourtName.trim() ? <Text style={styles.legacy}>Legacy court: create or select a saved court before changing this case.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

      <Modal visible={visible} animationType="slide" onRequestClose={() => setVisible(false)}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Court</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close court list" onPress={() => setVisible(false)} hitSlop={12}><Text style={styles.close}>Close</Text></Pressable>
          </View>
          <TextInput value={search} onChangeText={setSearch} placeholder="Search courts" placeholderTextColor={colors.textMuted} style={styles.search} accessibilityLabel="Search courts" />
          <Pressable accessibilityRole="button" onPress={() => { setVisible(false); setAdding(true); }} style={styles.newCourt}><Ionicons name="add-circle-outline" size={22} color={colors.primary} /><Text style={styles.newCourtText}>Add New Court</Text></Pressable>
          {loadError ? <Text accessibilityRole="alert" style={styles.loadError}>{loadError}</Text> : loading ? <ActivityIndicator style={styles.loading} color={colors.primary} /> : (
            <FlatList data={courts} keyExtractor={(item) => item.id} keyboardShouldPersistTaps="handled" contentContainerStyle={courts.length ? styles.list : styles.emptyList} ListEmptyComponent={<Text style={styles.empty}>No saved courts found. Add one to continue.</Text>} renderItem={({ item }) => (
              <Pressable accessibilityRole="radio" accessibilityState={{ checked: item.id === selectedCourtId }} onPress={() => { onSelect(item); setVisible(false); }} style={({ pressed }) => [styles.courtRow, item.id === selectedCourtId && styles.courtSelected, pressed && styles.pressed]}>
                <View style={styles.courtText}><Text style={styles.courtName}>{item.fullName}</Text><Text style={styles.shortCode}>{item.shortCode}</Text></View>
                {item.id === selectedCourtId ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
              </Pressable>
            )} />
          )}
        </SafeAreaView>
      </Modal>
      <CourtEditorModal visible={adding} onClose={() => setAdding(false)} onSaved={(court) => { onSelect(court); setAdding(false); setVisible(false); setCourts((current) => [...current.filter((item) => item.id !== court.id), court]); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.sm }, labelRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  label: { ...typography.bodyStrong, color: colors.text }, required: { color: colors.danger },
  addButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm }, addText: { ...typography.bodyStrong, color: colors.primary },
  selector: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface }, selectorError: { borderColor: colors.danger }, selectorText: { ...typography.body, flex: 1, color: colors.text }, placeholder: { color: colors.textMuted },
  legacy: { ...typography.caption, color: colors.pending }, error: { ...typography.caption, color: colors.danger },
  loadError: { ...typography.body, padding: spacing.xl, textAlign: 'center', color: colors.danger },
  modal: { flex: 1, backgroundColor: colors.background }, modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.xl, backgroundColor: colors.surface }, modalTitle: { ...typography.heading, color: colors.text }, close: { ...typography.bodyStrong, color: colors.primary },
  search: { minHeight: 48, margin: spacing.xl, marginBottom: spacing.md, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, color: colors.text, backgroundColor: colors.surface, ...typography.body },
  newCourt: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.xl, marginBottom: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft }, newCourtText: { ...typography.bodyStrong, color: colors.primary },
  list: { padding: spacing.xl, paddingTop: spacing.sm, gap: spacing.sm }, emptyList: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }, empty: { ...typography.body, textAlign: 'center', color: colors.textMuted }, loading: { marginTop: spacing.xxl },
  courtRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface }, courtSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft }, courtText: { flex: 1, gap: spacing.xs }, courtName: { ...typography.bodyStrong, color: colors.text }, shortCode: { ...typography.caption, color: colors.textMuted }, pressed: { opacity: 0.78 },
});
