import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppCard } from '../components/AppCard';
import { DatePickerField } from '../components/DatePickerField';
import { EmptyState } from '../components/EmptyState';
import { PrimaryButton } from '../components/PrimaryButton';
import type { CaseTask } from '../models/CaseTask';
import type { CaseTasksScreenProps } from '../navigation/types';
import { createCaseTask, deleteCaseTask, getTasksByCaseId, setCaseTaskCompleted, updateCaseTask } from '../repositories/caseTaskRepository';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { formatDisplayDate } from '../utils/date';

export function CaseTasksScreen({ route }: CaseTasksScreenProps) {
  const { caseId } = route.params;
  const [tasks, setTasks] = useState<CaseTask[]>([]);
  const [editing, setEditing] = useState<CaseTask | null | undefined>(undefined);
  const load = useCallback(async () => setTasks(await getTasksByCaseId(caseId)), [caseId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function confirmDelete(task: CaseTask) {
    Alert.alert('Delete To-do?', 'This task will be removed. The case will not be affected.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void removeTask(task) },
    ]);
  }

  async function removeTask(task: CaseTask) {
    try { await deleteCaseTask(task.id); await load(); }
    catch (error) { console.error('Unable to delete to-do.', error); Alert.alert('Unable to delete to-do', 'The task was not changed.'); }
  }

  async function toggleTask(task: CaseTask) {
    try { await setCaseTaskCompleted(task.id, !task.completed); await load(); }
    catch (error) { console.error('Unable to update to-do.', error); Alert.alert('Unable to update to-do', 'The task was not changed.'); }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <FlatList data={tasks} keyExtractor={(item) => item.id} contentContainerStyle={tasks.length ? styles.list : styles.emptyList} ListHeaderComponent={<PrimaryButton label="Add To-do" onPress={() => setEditing(null)} />} ListEmptyComponent={<EmptyState icon="checkbox-outline" title="No To-dos Yet" message="Add case-specific tasks such as preparing documents or calling a client." />} renderItem={({ item }) => (
        <AppCard style={[styles.task, item.completed && styles.completedTask]}>
          <Pressable accessibilityRole="checkbox" accessibilityLabel={`${item.completed ? 'Reopen' : 'Complete'} ${item.title}`} accessibilityState={{ checked: item.completed }} onPress={() => void toggleTask(item)} style={styles.checkbox}><Ionicons name={item.completed ? 'checkbox' : 'square-outline'} size={28} color={item.completed ? colors.primary : colors.textMuted} /></Pressable>
          <View style={styles.taskText}><Text style={[styles.title, item.completed && styles.completedText]}>{item.title}</Text>{item.note ? <Text style={[styles.note, item.completed && styles.completedText]}>{item.note}</Text> : null}<Text style={styles.meta}>{item.completed ? `Completed ${formatDisplayDate(item.completedAt)}` : item.dueDate ? `Due ${formatDisplayDate(item.dueDate)}` : 'No due date'}</Text></View>
          <View><Pressable accessibilityRole="button" accessibilityLabel={`Edit ${item.title}`} onPress={() => setEditing(item)} style={styles.icon}><Ionicons name="create-outline" size={20} color={colors.primary} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Delete ${item.title}`} onPress={() => confirmDelete(item)} style={styles.icon}><Ionicons name="trash-outline" size={20} color={colors.danger} /></Pressable></View>
        </AppCard>
      )} />
      <TaskEditor visible={editing !== undefined} task={editing ?? null} caseId={caseId} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); void load(); }} />
    </SafeAreaView>
  );
}

function TaskEditor({ visible, task, caseId, onClose, onSaved }: { visible: boolean; task: CaseTask | null; caseId: string; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(''); const [note, setNote] = useState(''); const [dueDate, setDueDate] = useState(''); const [error, setError] = useState<string | null>(null); const [saving, setSaving] = useState(false); const savingRef = useRef(false);
  useEffect(() => { if (visible) { setTitle(task?.title ?? ''); setNote(task?.note ?? ''); setDueDate(task?.dueDate ?? ''); setError(null); } }, [task, visible]);
  async function save() { if (savingRef.current) return; savingRef.current = true; setSaving(true); setError(null); try { if (task) await updateCaseTask(task.id, { title, note, dueDate }); else await createCaseTask({ caseId, title, note, dueDate }); onSaved(); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'The to-do could not be saved.'); } finally { savingRef.current = false; setSaving(false); } }
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.editorScroll}><View style={styles.editor}><View style={styles.editorHeader}><Text style={styles.editorTitle}>{task ? 'Edit To-do' : 'Add To-do'}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close to-do form" onPress={onClose}><Text style={styles.close}>Close</Text></Pressable></View><View style={styles.field}><Text style={styles.label}>Task Title *</Text><TextInput value={title} onChangeText={setTitle} placeholder="What needs to be done?" placeholderTextColor={colors.textMuted} style={styles.input} maxLength={300} accessibilityLabel="Task title" /></View><View style={styles.field}><Text style={styles.label}>Note</Text><TextInput value={note} onChangeText={setNote} placeholder="Optional details" placeholderTextColor={colors.textMuted} style={[styles.input, styles.noteInput]} multiline maxLength={3000} accessibilityLabel="Task note" /></View><DatePickerField label="Due Date" value={dueDate} onChange={setDueDate} helperText="Optional" />{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}<PrimaryButton label={task ? 'Save Changes' : 'Add To-do'} onPress={() => void save()} loading={saving} /></View></ScrollView></KeyboardAvoidingView></Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, list: { gap: spacing.md, padding: spacing.xl, paddingBottom: spacing.xxxl }, emptyList: { flexGrow: 1, gap: spacing.md, padding: spacing.xl }, task: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }, completedTask: { opacity: 0.72 }, checkbox: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }, taskText: { flex: 1, gap: spacing.xs }, title: { ...typography.bodyStrong, color: colors.text }, note: { ...typography.body, color: colors.textMuted }, completedText: { textDecorationLine: 'line-through' }, meta: { ...typography.caption, color: colors.primary }, icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.55)' }, editorScroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl }, editor: { gap: spacing.lg, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.surface }, editorHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, editorTitle: { ...typography.heading, color: colors.text }, close: { ...typography.bodyStrong, color: colors.primary }, field: { gap: spacing.sm }, label: { ...typography.bodyStrong, color: colors.text }, input: { minHeight: 48, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, color: colors.text, ...typography.body }, noteInput: { minHeight: 88, textAlignVertical: 'top' }, error: { ...typography.caption, color: colors.danger },
});
