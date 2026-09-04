import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppCard } from '../components/AppCard';
import { EmptyState } from '../components/EmptyState';
import { PrimaryButton } from '../components/PrimaryButton';
import type { CaseDocument } from '../models/CaseDocument';
import type { DocumentDetailsScreenProps } from '../navigation/types';
import { getDocumentById } from '../repositories/documentRepository';
import { deleteDocumentWithFile, updateDocumentDetails } from '../services/documentService';
import { checkFileExists, openPdf, shareFile } from '../services/fileService';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { formatDisplayDate } from '../utils/date';

export function DocumentDetailsScreen({ navigation, route }: DocumentDetailsScreenProps) {
  const [document, setDocument] = useState<CaseDocument | null>(null);
  const [fileName, setFileName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<'save' | 'share' | 'open' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actionRef = useRef(false);
  const { documentId } = route.params;

  const loadDocument = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await getDocumentById(documentId);
      setDocument(loaded);
      setFileName(loaded?.fileName ?? '');
      setDescription(loaded?.description ?? '');
    } catch (loadError) {
      console.error('Unable to load document details.', loadError);
      setError('The document details could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useFocusEffect(useCallback(() => { void loadDocument(); }, [loadDocument]));

  async function runAction(action: Exclude<typeof busyAction, null>, task: () => Promise<void>) {
    if (actionRef.current) return;
    actionRef.current = true;
    setBusyAction(action);
    try {
      await task();
    } finally {
      actionRef.current = false;
      setBusyAction(null);
    }
  }

  async function handleSave() {
    await runAction('save', async () => {
      try {
        const updated = await updateDocumentDetails(documentId, fileName, description);
        if (!updated) {
          Alert.alert('Document not found', 'This document may have been removed.');
          return;
        }
        setDocument(updated);
        setFileName(updated.fileName);
        setDescription(updated.description ?? '');
        Alert.alert('Saved', 'Document details were updated.');
      } catch (saveError) {
        console.error('Unable to update document details.', saveError);
        Alert.alert('Unable to save', 'Check the document name and try again.');
      }
    });
  }

  async function handleShare() {
    if (!document) return;
    await runAction('share', async () => {
      try {
        await shareFile(document.filePath, document.fileType);
      } catch (shareError) {
        console.error('Unable to share document.', shareError);
        Alert.alert('Unable to share', 'The file may be missing or sharing may be unavailable.');
      }
    });
  }

  async function handleOpen() {
    if (!document) return;
    if (document.fileType === 'IMAGE') {
      navigation.navigate('ImagePreview', { documentId });
      return;
    }
    await runAction('open', async () => {
      try {
        await openPdf(document.filePath);
      } catch (openError) {
        console.error('Unable to open PDF.', openError);
        Alert.alert('Unable to open PDF', 'No compatible PDF app may be installed. You can share the file instead.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Share', onPress: () => void handleShare() },
        ]);
      }
    });
  }

  function confirmDelete() {
    const fileExists = document ? checkFileExists(document.filePath) : false;
    Alert.alert(fileExists ? 'Delete Document?' : 'Remove Document Record?', fileExists ? 'This document will be permanently removed from this device.' : 'The local file is missing. Remove its document record from this case?', [
      { text: 'Cancel', style: 'cancel' },
      { text: fileExists ? 'Delete' : 'Remove', style: 'destructive', onPress: () => void handleDelete() },
    ]);
  }

  async function handleDelete() {
    await runAction('delete', async () => {
      try {
        const result = await deleteDocumentWithFile(documentId);
        if (!result.deleted) {
          Alert.alert('Document not found', 'This document has already been removed.');
        } else if (result.fileCleanupFailed) {
          Alert.alert('Document removed', 'Its database record was removed, but an unused local file could not be cleaned up.');
        }
        navigation.goBack();
      } catch (deleteError) {
        console.error('Unable to delete document.', deleteError);
        Alert.alert('Unable to delete', 'The document could not be removed. Please try again.');
      }
    });
  }

  if (loading) return <ScreenState label="Loading document…" />;
  if (error) return <SafeAreaView style={styles.screen} edges={['bottom']}><EmptyState icon="alert-circle-outline" title="Unable to load document" message={error} actionLabel="Try again" onAction={() => void loadDocument()} /></SafeAreaView>;
  if (!document) return <SafeAreaView style={styles.screen} edges={['bottom']}><EmptyState icon="document-outline" title="Document not found" message="This document may have been removed from the device." actionLabel="Go Back" onAction={navigation.goBack} /></SafeAreaView>;

  const fileExists = checkFileExists(document.filePath);
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <AppCard style={styles.summaryCard}>
            <View style={styles.fileIcon}><Ionicons name={document.fileType === 'PDF' ? 'document-text-outline' : 'image-outline'} size={28} color={colors.primary} /></View>
            <View style={styles.summaryText}>
              <Text style={styles.documentName}>{document.fileName}</Text>
              <Text style={styles.metadata}>{document.fileType} · {formatDisplayDate(document.createdAt)}</Text>
              {!fileExists ? <Text style={styles.missingText}>File Missing — this file is no longer available on this device.</Text> : null}
            </View>
          </AppCard>

          <View style={styles.actionRow}>
            <ActionButton icon={document.fileType === 'PDF' ? 'open-outline' : 'eye-outline'} label={document.fileType === 'PDF' ? 'Open' : 'Preview'} loading={busyAction === 'open'} disabled={!fileExists || busyAction !== null} onPress={() => void handleOpen()} />
            <ActionButton icon="share-social-outline" label="Share" loading={busyAction === 'share'} disabled={!fileExists || busyAction !== null} onPress={() => void handleShare()} />
          </View>

          <View style={styles.formSection}>
            <Text style={styles.sectionTitle}>DOCUMENT DETAILS</Text>
            <AppCard style={styles.formCard}>
              <View style={styles.field}>
                <Text style={styles.label}>Display Name</Text>
                <TextInput value={fileName} onChangeText={setFileName} maxLength={240} autoCapitalize="sentences" style={styles.input} accessibilityLabel="Document display name" />
                <Text style={styles.helper}>The stored file is not renamed.</Text>
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Description</Text>
                <TextInput value={description} onChangeText={setDescription} placeholder="Optional document description" placeholderTextColor={colors.textMuted} multiline maxLength={3000} textAlignVertical="top" style={[styles.input, styles.descriptionInput]} accessibilityLabel="Document description" />
              </View>
            </AppCard>
          </View>

          <PrimaryButton label="Save Details" loading={busyAction === 'save'} disabled={busyAction !== null} onPress={() => void handleSave()} />
          <Pressable accessibilityRole="button" accessibilityLabel={fileExists ? 'Delete document' : 'Remove missing document record'} disabled={busyAction !== null} onPress={confirmDelete} style={({ pressed }) => [styles.deleteButton, pressed && styles.deletePressed]}>
            {busyAction === 'delete' ? <ActivityIndicator color={colors.danger} /> : <><Ionicons name="trash-outline" size={18} color={colors.danger} /><Text style={styles.deleteText}>{fileExists ? 'Delete Document' : 'Remove Record'}</Text></>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ScreenState({ label }: { label: string }) {
  return <SafeAreaView style={styles.screen} edges={['bottom']}><View style={styles.stateContainer}><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.stateText}>{label}</Text></View></SafeAreaView>;
}

function ActionButton({ icon, label, onPress, loading, disabled }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; loading: boolean; disabled: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.actionButton, pressed && styles.actionPressed, disabled && styles.disabled]}>{loading ? <ActivityIndicator color={colors.primary} /> : <Ionicons name={icon} size={21} color={colors.primary} />}<Text style={styles.actionText}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { gap: spacing.xl, padding: spacing.xl, paddingBottom: spacing.xxxl },
  stateContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  stateText: { ...typography.body, color: colors.textMuted },
  summaryCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  fileIcon: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primarySoft },
  summaryText: { flex: 1, gap: spacing.xs },
  documentName: { ...typography.subheading, color: colors.text },
  metadata: { ...typography.caption, color: colors.textMuted },
  missingText: { ...typography.caption, color: colors.danger },
  actionRow: { flexDirection: 'row', gap: spacing.md },
  actionButton: { minHeight: 56, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  actionPressed: { backgroundColor: colors.primarySoft },
  actionText: { ...typography.bodyStrong, color: colors.primary },
  disabled: { opacity: 0.5 },
  formSection: { gap: spacing.md },
  sectionTitle: { ...typography.label, color: colors.textMuted },
  formCard: { gap: spacing.lg },
  field: { gap: spacing.sm },
  label: { ...typography.bodyStrong, color: colors.text },
  input: { minHeight: 48, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, color: colors.text, ...typography.body },
  descriptionInput: { minHeight: 120 },
  helper: { ...typography.caption, color: colors.textMuted },
  deleteButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  deletePressed: { backgroundColor: colors.dangerBackground },
  deleteText: { ...typography.bodyStrong, color: colors.danger },
});
