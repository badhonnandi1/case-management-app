import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CaseForm, caseToFormValues } from '../components/CaseForm';
import { EmptyState } from '../components/EmptyState';
import type { Case, CreateCaseInput } from '../models/Case';
import type { EditCaseScreenProps } from '../navigation/types';
import { getCaseById, updateCase } from '../repositories/caseRepository';
import { rescheduleCaseReminder } from '../services/notificationService';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

export function EditCaseScreen({ navigation, route }: EditCaseScreenProps) {
  const [caseItem, setCaseItem] = useState<Case | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const { caseId } = route.params;

  const loadCase = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      setCaseItem(await getCaseById(caseId));
    } catch (error) {
      console.error('Unable to load case for editing.', error);
      setLoadError('The case could not be loaded for editing.');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useFocusEffect(
    useCallback(() => {
      void loadCase();
    }, [loadCase]),
  );

  async function handleSubmit(input: CreateCaseInput) {
    setSubmissionError(null);

    try {
      const updatedCase = await updateCase(caseId, input);
      if (!updatedCase) {
        setSubmissionError('This case no longer exists on this device.');
        return;
      }
      try {
        await rescheduleCaseReminder(updatedCase);
      } catch (reminderError) {
        console.error('Case updated, but its reminder could not be changed.', reminderError);
        Alert.alert('Case updated', 'Changes were saved, but the hearing reminder could not be updated.');
      }
      navigation.goBack();
    } catch (error) {
      console.error('Unable to update case.', error);
      setSubmissionError('The changes could not be saved. Please try again.');
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <View style={styles.stateContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.stateText}>Loading case…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <EmptyState
          icon="alert-circle-outline"
          title="Unable to edit case"
          message={loadError}
          actionLabel="Try again"
          onAction={() => void loadCase()}
        />
      </SafeAreaView>
    );
  }

  if (!caseItem) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <EmptyState
          icon="document-outline"
          title="Case not found"
          message="This case may have been removed from the device."
          actionLabel="Go back"
          onAction={navigation.goBack}
        />
      </SafeAreaView>
    );
  }

  return (
    <CaseForm
      initialValues={caseToFormValues(caseItem)}
      submitLabel="Save Changes"
      onSubmit={handleSubmit}
      submissionError={submissionError}
    />
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  stateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  stateText: {
    ...typography.body,
    color: colors.textMuted,
  },
});
