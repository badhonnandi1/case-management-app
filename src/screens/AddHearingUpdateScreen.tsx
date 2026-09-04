import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '../components/EmptyState';
import { DatePickerField } from '../components/DatePickerField';
import { PrimaryButton } from '../components/PrimaryButton';
import type { Case } from '../models/Case';
import type { PaymentStatus } from '../models/CaseHistory';
import type { AddHearingUpdateScreenProps } from '../navigation/types';
import { getCaseById } from '../repositories/caseRepository';
import { recordHearingUpdate } from '../repositories/caseHistoryRepository';
import { rescheduleCaseReminder } from '../services/notificationService';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { isValidDateOnly, toLocalDateString } from '../utils/date';
import { parsePaymentAmountMinor } from '../utils/payment';

interface HearingFormValues {
  hearingDate: string;
  orderText: string;
  nextDate: string;
  nextStep: string;
  notes: string;
  paymentStatus: PaymentStatus | '';
  paymentAmount: string;
  paymentNote: string;
}

type HearingFormErrors = Partial<Record<keyof HearingFormValues, string>>;

export function AddHearingUpdateScreen({ navigation, route }: AddHearingUpdateScreenProps) {
  const [caseItem, setCaseItem] = useState<Case | null>(null);
  const [values, setValues] = useState<HearingFormValues | null>(null);
  const [errors, setErrors] = useState<HearingFormErrors>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const { caseId } = route.params;

  const loadCase = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const loadedCase = await getCaseById(caseId);
      setCaseItem(loadedCase);
      setValues(
        loadedCase
          ? {
              hearingDate: loadedCase.nextDate ?? toLocalDateString(),
              orderText: '',
              nextDate: '',
              nextStep: '',
              notes: '',
              paymentStatus: '',
              paymentAmount: '',
              paymentNote: '',
            }
          : null,
      );
    } catch (error) {
      console.error('Unable to prepare the hearing update form.', error);
      setLoadError('The case could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void loadCase();
  }, [loadCase]);

  function updateValue<Key extends keyof HearingFormValues>(
    key: Key,
    value: HearingFormValues[Key],
  ) {
    setValues((current) => (current ? { ...current, [key]: value } : current));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setSubmissionError(null);
  }

  async function handleSubmit() {
    if (!values || submittingRef.current) {
      return;
    }

    Keyboard.dismiss();
    const validationErrors = validateHearingForm(values);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setSubmissionError(null);
    try {
      await recordHearingUpdate({
        caseId,
        hearingDate: values.hearingDate.trim(),
        orderText: optionalText(values.orderText),
        nextDate: optionalText(values.nextDate),
        nextStep: optionalText(values.nextStep),
        notes: optionalText(values.notes),
        paymentStatus: values.paymentStatus || null,
        paymentAmountMinor: values.paymentStatus === 'PAID' ? parsePaymentAmountMinor(values.paymentAmount) : null,
        paymentNote: values.paymentStatus ? optionalText(values.paymentNote) : null,
      });
      try {
        const updatedCase = await getCaseById(caseId);
        if (updatedCase) await rescheduleCaseReminder(updatedCase);
      } catch (reminderError) {
        console.error('Hearing update saved, but its reminder could not be rescheduled.', reminderError);
      }
      navigation.goBack();
    } catch (error) {
      console.error('Unable to record hearing update.', error);
      setSubmissionError('The hearing update could not be saved. Please try again.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <View style={styles.stateContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.stateText}>Preparing hearing update…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <EmptyState
          icon="alert-circle-outline"
          title="Unable to load case"
          message={loadError}
          actionLabel="Try again"
          onAction={() => void loadCase()}
        />
      </SafeAreaView>
    );
  }

  if (!caseItem || !values) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <EmptyState
          icon="document-outline"
          title="Case not found"
          message="This case may have been removed from the device."
          actionLabel="Go Back"
          onAction={() => navigation.goBack()}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.contextCard}>
            <Text style={styles.caseTitle} numberOfLines={2}>{caseItem.caseTitle}</Text>
            <Text style={styles.caseNumber}>{caseItem.caseNumber}</Text>
          </View>

          <FormSection title="Hearing">
            <DatePickerField
              label="Hearing Date"
              required
              value={values.hearingDate}
              onChange={(value) => updateValue('hearingDate', value)}
              helperText="Tap to select the completed hearing date"
              error={errors.hearingDate}
              allowClear={false}
            />
          </FormSection>

          <FormSection title="Court Order">
            <FormInput
              label="Order / What Happened"
              value={values.orderText}
              onChangeText={(value) => updateValue('orderText', value)}
              placeholder="Optional court order or outcome"
              autoCapitalize="sentences"
              multiline
              maxLength={5000}
            />
          </FormSection>

          <FormSection title="Next Hearing">
            <DatePickerField
              label="Next Hearing Date"
              value={values.nextDate}
              onChange={(value) => updateValue('nextDate', value)}
              helperText="Optional; tap to select the announced date"
              error={errors.nextDate}
            />
            <FormInput
              label="Next Step / Preparation"
              value={values.nextStep}
              onChangeText={(value) => updateValue('nextStep', value)}
              placeholder="Optional preparation or action"
              autoCapitalize="sentences"
              multiline
              maxLength={5000}
            />
          </FormSection>

          <FormSection title="Payment">
            <Text style={styles.fieldLabel}>Payment Status</Text>
            <View style={styles.paymentOptions}>
              {(['PAID', 'UNPAID'] as const).map((status) => {
                const selected = values.paymentStatus === status;
                return (
                  <Pressable key={status} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={status === 'PAID' ? 'Paid' : 'Unpaid'} onPress={() => updateValue('paymentStatus', status)} style={({ pressed }) => [styles.paymentOption, selected && styles.paymentOptionSelected, pressed && styles.pressed]}>
                    <Text style={[styles.paymentLabel, selected && styles.paymentLabelSelected]}>{status === 'PAID' ? 'Paid' : 'Unpaid'}</Text>
                  </Pressable>
                );
              })}
              <Pressable accessibilityRole="radio" accessibilityState={{ checked: values.paymentStatus === '' }} accessibilityLabel="Payment not recorded" onPress={() => { updateValue('paymentStatus', ''); updateValue('paymentAmount', ''); updateValue('paymentNote', ''); }} style={({ pressed }) => [styles.paymentOption, values.paymentStatus === '' && styles.paymentOptionSelected, pressed && styles.pressed]}><Text style={[styles.paymentLabel, values.paymentStatus === '' && styles.paymentLabelSelected]}>Not recorded</Text></Pressable>
            </View>
            {errors.paymentStatus ? <Text accessibilityRole="alert" style={styles.fieldError}>{errors.paymentStatus}</Text> : null}
            {values.paymentStatus === 'PAID' ? <FormInput label="Payment Amount" value={values.paymentAmount} onChangeText={(value) => updateValue('paymentAmount', value)} placeholder="Optional, e.g. 1500.00" error={errors.paymentAmount} keyboardType="decimal-pad" maxLength={18} /> : null}
            {values.paymentStatus ? <FormInput label="Payment Note" value={values.paymentNote} onChangeText={(value) => updateValue('paymentNote', value)} placeholder="Optional short note" maxLength={500} /> : null}
          </FormSection>

          <FormSection title="Additional Notes">
            <FormInput
              label="Notes"
              value={values.notes}
              onChangeText={(value) => updateValue('notes', value)}
              placeholder="Optional notes from the hearing"
              autoCapitalize="sentences"
              multiline
              large
              maxLength={10000}
            />
          </FormSection>

          {submissionError ? (
            <Text accessibilityRole="alert" style={styles.submissionError}>
              {submissionError}
            </Text>
          ) : null}

          <PrimaryButton
            label="Save Hearing Update"
            onPress={() => void handleSubmit()}
            loading={submitting}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

interface FormSectionProps {
  title: string;
  children: React.ReactNode;
}

function FormSection({ title, children }: FormSectionProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      <View style={styles.sectionFields}>{children}</View>
    </View>
  );
}

interface FormInputProps extends Pick<
  TextInputProps,
  'autoCapitalize' | 'keyboardType' | 'maxLength' | 'multiline'
> {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  error?: string;
  helperText?: string;
  required?: boolean;
  large?: boolean;
}

function FormInput({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  helperText,
  required = false,
  multiline = false,
  large = false,
  autoCapitalize,
  maxLength,
  keyboardType,
}: FormInputProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}{required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoCapitalize={autoCapitalize}
        autoCorrect={multiline}
        maxLength={maxLength}
        keyboardType={keyboardType}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[
          styles.input,
          multiline && styles.multilineInput,
          large && styles.largeInput,
          error && styles.inputError,
        ]}
        accessibilityLabel={label}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.fieldError}>{error}</Text>
      ) : helperText ? (
        <Text style={styles.helperText}>{helperText}</Text>
      ) : null}
    </View>
  );
}

function validateHearingForm(values: HearingFormValues): HearingFormErrors {
  const errors: HearingFormErrors = {};
  const hearingDate = values.hearingDate.trim();
  const nextDate = values.nextDate.trim();

  if (!hearingDate) {
    errors.hearingDate = 'Hearing date is required.';
  } else if (!isValidDateOnly(hearingDate)) {
    errors.hearingDate = 'Enter a valid date in YYYY-MM-DD format.';
  }
  if (nextDate && !isValidDateOnly(nextDate)) {
    errors.nextDate = 'Enter a valid date in YYYY-MM-DD format.';
  }
  if (values.paymentStatus !== 'PAID' && values.paymentAmount.trim()) {
    errors.paymentAmount = 'Select Paid before entering an amount.';
  } else if (values.paymentStatus === 'PAID') {
    try { parsePaymentAmountMinor(values.paymentAmount); } catch (error) {
      errors.paymentAmount = error instanceof Error ? error.message : 'Enter a valid amount.';
    }
  }
  return errors;
}

function optionalText(value: string): string | null {
  return value.trim() || null;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { gap: spacing.xxl, padding: spacing.xl, paddingBottom: spacing.xxxl },
  stateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  stateText: { ...typography.body, color: colors.textMuted },
  contextCard: {
    gap: spacing.xs,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
  },
  caseTitle: { ...typography.subheading, color: colors.text },
  caseNumber: { ...typography.caption, color: colors.primary },
  section: { gap: spacing.md },
  sectionTitle: { ...typography.label, color: colors.textMuted },
  sectionFields: {
    gap: spacing.lg,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  field: { gap: spacing.sm },
  fieldLabel: { ...typography.bodyStrong, color: colors.text },
  required: { color: colors.danger },
  input: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    ...typography.body,
  },
  multilineInput: { minHeight: 96 },
  largeInput: { minHeight: 140 },
  inputError: { borderColor: colors.danger },
  fieldError: { ...typography.caption, color: colors.danger },
  helperText: { ...typography.caption, color: colors.textMuted },
  paymentOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  paymentOption: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, backgroundColor: colors.surface },
  paymentOptionSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  paymentLabel: { ...typography.bodyStrong, color: colors.textMuted },
  paymentLabelSelected: { color: colors.primary },
  pressed: { opacity: 0.78 },
  submissionError: {
    ...typography.body,
    padding: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerBackground,
    color: colors.danger,
  },
});
