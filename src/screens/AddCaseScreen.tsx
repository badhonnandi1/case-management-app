import { useState } from 'react';
import { Alert } from 'react-native';

import { CaseForm, EMPTY_CASE_FORM_VALUES } from '../components/CaseForm';
import type { AddCaseScreenProps } from '../navigation/types';
import { createCase } from '../repositories/caseRepository';
import type { CreateCaseInput } from '../models/Case';
import { scheduleCaseReminder } from '../services/notificationService';

export function AddCaseScreen({ navigation }: AddCaseScreenProps) {
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  async function handleSubmit(input: CreateCaseInput) {
    setSubmissionError(null);

    try {
      const createdCase = await createCase(input);
      try {
        await scheduleCaseReminder(createdCase);
      } catch (reminderError) {
        console.error('Case saved, but its reminder could not be scheduled.', reminderError);
        Alert.alert('Case saved', 'The case was saved, but its hearing reminder could not be scheduled.');
      }
      navigation.replace('CaseDetails', { caseId: createdCase.id });
    } catch (error) {
      console.error('Unable to create case.', error);
      setSubmissionError('The case could not be saved. Please try again.');
    }
  }

  return (
    <CaseForm
      initialValues={EMPTY_CASE_FORM_VALUES}
      submitLabel="Save Case"
      onSubmit={handleSubmit}
      submissionError={submissionError}
      includeInitialPayment
    />
  );
}
