import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Court } from '../models/Court';
import { createCourt, updateCourt } from '../repositories/courtRepository';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { PrimaryButton } from './PrimaryButton';

export function CourtEditorModal({ visible, court, onClose, onSaved }: {
  visible: boolean;
  court?: Court | null;
  onClose: () => void;
  onSaved: (court: Court) => void;
}) {
  const [fullName, setFullName] = useState('');
  const [shortCode, setShortCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setFullName(court?.fullName ?? '');
    setShortCode(court?.shortCode ?? '');
    setError(null);
  }, [court, visible]);

  async function save() {
    if (savingRef.current) return;
    if (!fullName.trim() || !shortCode.trim()) {
      setError('Full court name and short code are required.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const saved = court
        ? await updateCourt(court.id, { fullName, shortCode })
        : await createCourt({ fullName, shortCode });
      if (!saved) throw new Error('Court not found.');
      onSaved(saved);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'The court could not be saved.';
      setError(message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.card} accessibilityViewIsModal>
          <View style={styles.headingRow}>
            <Text style={styles.title}>{court ? 'Edit Court' : 'Add New Court'}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close court form" onPress={onClose} hitSlop={12}>
              <Text style={styles.close}>Close</Text>
            </Pressable>
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Full Court Name <Text style={styles.required}>*</Text></Text>
            <TextInput value={fullName} onChangeText={setFullName} placeholder="e.g. সদর সিভিল জজ আদালত" placeholderTextColor={colors.textMuted} style={styles.input} maxLength={250} accessibilityLabel="Full court name" />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Short Code <Text style={styles.required}>*</Text></Text>
            <TextInput value={shortCode} onChangeText={setShortCode} placeholder="e.g. সদর" placeholderTextColor={colors.textMuted} style={styles.input} maxLength={60} accessibilityLabel="Court short code" />
            <Text style={styles.helper}>Used as the compact court label in Daily Cause Lists.</Text>
          </View>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <PrimaryButton label={court ? 'Save Court' : 'Add Court'} onPress={() => void save()} loading={saving} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', padding: spacing.xl, backgroundColor: 'rgba(15, 23, 42, 0.55)' },
  card: { gap: spacing.lg, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surface },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  title: { ...typography.heading, flex: 1, color: colors.text },
  close: { ...typography.bodyStrong, color: colors.primary },
  field: { gap: spacing.sm },
  label: { ...typography.bodyStrong, color: colors.text },
  required: { color: colors.danger },
  input: { minHeight: 48, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, color: colors.text, ...typography.body },
  helper: { ...typography.caption, color: colors.textMuted },
  error: { ...typography.body, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerBackground, color: colors.danger },
});
