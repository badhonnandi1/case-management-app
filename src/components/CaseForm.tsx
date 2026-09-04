import { useRef, useState } from 'react';
import {
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

import type { Case, CaseStatus, CreateCaseInput, RepresentedSide } from '../models/Case';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { isValidDateOnly } from '../utils/date';
import { buildCaseNumber, parseCaseNumber } from '../utils/caseFormat';
import { DatePickerField } from './DatePickerField';
import { PrimaryButton } from './PrimaryButton';

export interface CaseFormValues {
  caseTitle: string;
  caseNumber: string;
  caseType: string;
  caseSerial: string;
  caseYear: string;
  partyName: string;
  oppositePartyName: string;
  representedSide: RepresentedSide | '';
  courtName: string;
  judgeName: string;
  previousDate: string;
  previousOrder: string;
  nextDate: string;
  nextStep: string;
  status: CaseStatus;
  notes: string;
}

type CaseFormErrors = Partial<Record<keyof CaseFormValues, string>>;

interface CaseFormProps {
  initialValues: CaseFormValues;
  submitLabel: string;
  onSubmit: (input: CreateCaseInput) => Promise<void>;
  submissionError?: string | null;
}

export const EMPTY_CASE_FORM_VALUES: CaseFormValues = {
  caseTitle: '',
  caseNumber: '',
  caseType: '',
  caseSerial: '',
  caseYear: '',
  partyName: '',
  oppositePartyName: '',
  representedSide: '',
  courtName: '',
  judgeName: '',
  previousDate: '',
  previousOrder: '',
  nextDate: '',
  nextStep: '',
  status: 'ACTIVE',
  notes: '',
};

const statusOptions: readonly CaseStatus[] = ['ACTIVE', 'PENDING', 'CLOSED'];

export function caseToFormValues(caseItem: Case): CaseFormValues {
  const parsedNumber = parseCaseNumber(caseItem.caseNumber);
  return {
    caseTitle: caseItem.caseTitle,
    caseNumber: caseItem.caseNumber,
    caseType: caseItem.caseType ?? parsedNumber.caseType,
    caseSerial: caseItem.caseSerial ?? parsedNumber.caseSerial,
    caseYear: caseItem.caseYear ?? parsedNumber.caseYear,
    partyName: caseItem.partyName,
    oppositePartyName: caseItem.oppositePartyName,
    representedSide: caseItem.representedSide ?? '',
    courtName: caseItem.courtName,
    judgeName: caseItem.judgeName ?? '',
    previousDate: caseItem.previousDate ?? '',
    previousOrder: caseItem.previousOrder ?? '',
    nextDate: caseItem.nextDate ?? '',
    nextStep: caseItem.nextStep ?? '',
    status: caseItem.status,
    notes: caseItem.notes ?? '',
  };
}

export function CaseForm({
  initialValues,
  submitLabel,
  onSubmit,
  submissionError,
}: CaseFormProps) {
  const [values, setValues] = useState<CaseFormValues>(initialValues);
  const [errors, setErrors] = useState<CaseFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [unexpectedError, setUnexpectedError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  function updateValue<Key extends keyof CaseFormValues>(
    key: Key,
    value: CaseFormValues[Key],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setUnexpectedError(null);
  }

  async function handleSubmit() {
    if (submittingRef.current) {
      return;
    }

    Keyboard.dismiss();
    const validationErrors = validateCaseForm(values);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setUnexpectedError(null);

    try {
      await onSubmit(toCreateCaseInput(values));
    } catch (error) {
      console.error('Unable to submit case form.', error);
      setUnexpectedError('The case could not be saved. Please try again.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
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
          <FormSection title="Case Information">
            <FormInput
              label="Case Title"
              required
              value={values.caseTitle}
              error={errors.caseTitle}
              onChangeText={(value) => updateValue('caseTitle', value)}
              placeholder="e.g. Rahman vs Karim"
              autoCapitalize="words"
              maxLength={200}
            />
            <CaseNumberFields
              caseType={values.caseType}
              caseSerial={values.caseSerial}
              caseYear={values.caseYear}
              errors={errors}
              onChange={(key, value) => updateValue(key, value)}
            />
          </FormSection>

          <FormSection title="Parties">
            <FormInput
              label="Party Name"
              required
              value={values.partyName}
              error={errors.partyName}
              onChangeText={(value) => updateValue('partyName', value)}
              placeholder="Client or represented party"
              autoCapitalize="words"
              maxLength={200}
            />
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>We Represent <Text style={styles.required}>*</Text></Text>
              <View style={styles.statusOptions}>
                {([
                  ['PLAINTIFF', 'Plaintiff (বাদী)'],
                  ['DEFENDANT', 'Defendant (বিবাদী)'],
                ] as const).map(([side, label]) => {
                  const selected = values.representedSide === side;
                  return (
                    <Pressable
                      key={side}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      onPress={() => updateValue('representedSide', side)}
                      style={({ pressed }) => [styles.statusOption, selected && styles.statusOptionSelected, pressed && styles.pressed]}
                    >
                      <Text style={[styles.statusLabel, selected && styles.statusLabelSelected]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {errors.representedSide ? <Text accessibilityRole="alert" style={styles.fieldError}>{errors.representedSide}</Text> : null}
            </View>
            <FormInput
              label="Opposite Party Name"
              value={values.oppositePartyName}
              error={errors.oppositePartyName}
              onChangeText={(value) => updateValue('oppositePartyName', value)}
              placeholder="Optional"
              autoCapitalize="words"
              maxLength={200}
            />
          </FormSection>

          <FormSection title="Court Information">
            <FormInput
              label="Court Name"
              required
              value={values.courtName}
              error={errors.courtName}
              onChangeText={(value) => updateValue('courtName', value)}
              placeholder="Court and location"
              autoCapitalize="words"
              maxLength={250}
            />
            <FormInput
              label="Judge Name"
              value={values.judgeName}
              error={errors.judgeName}
              onChangeText={(value) => updateValue('judgeName', value)}
              placeholder="Optional"
              autoCapitalize="words"
              maxLength={200}
            />
          </FormSection>

          <FormSection title="Hearing Information">
            <DatePickerField
              label="Previous Date"
              value={values.previousDate}
              error={errors.previousDate}
              onChange={(value) => updateValue('previousDate', value)}
              helperText="Tap to select a date"
            />
            <FormInput
              label="Previous Day Order"
              value={values.previousOrder}
              error={errors.previousOrder}
              onChangeText={(value) => updateValue('previousOrder', value)}
              placeholder="Optional order or outcome"
              autoCapitalize="sentences"
              multiline
              maxLength={5000}
            />
            <DatePickerField
              label="Next Date"
              value={values.nextDate}
              error={errors.nextDate}
              onChange={(value) => updateValue('nextDate', value)}
              helperText="Tap to select a date"
            />
            <FormInput
              label="Next Day Step"
              value={values.nextStep}
              error={errors.nextStep}
              onChangeText={(value) => updateValue('nextStep', value)}
              placeholder="Optional preparation or action"
              autoCapitalize="sentences"
              multiline
              maxLength={5000}
            />
          </FormSection>

          <FormSection title="Status">
            <View style={styles.statusOptions}>
              {statusOptions.map((status) => {
                const selected = values.status === status;
                return (
                  <Pressable
                    key={status}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => updateValue('status', status)}
                    style={({ pressed }) => [
                      styles.statusOption,
                      selected && styles.statusOptionSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View
                      style={[
                        styles.statusDot,
                        status === 'ACTIVE' && styles.activeDot,
                        status === 'PENDING' && styles.pendingDot,
                        status === 'CLOSED' && styles.closedDot,
                      ]}
                    />
                    <Text
                      style={[
                        styles.statusLabel,
                        selected && styles.statusLabelSelected,
                      ]}
                    >
                      {toTitleCase(status)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </FormSection>

          <FormSection title="Notes">
            <FormInput
              label="Notes"
              value={values.notes}
              error={errors.notes}
              onChangeText={(value) => updateValue('notes', value)}
              placeholder="Optional case notes"
              autoCapitalize="sentences"
              multiline
              large
              maxLength={10000}
            />
          </FormSection>

          {submissionError || unexpectedError ? (
            <Text accessibilityRole="alert" style={styles.submissionError}>
              {submissionError ?? unexpectedError}
            </Text>
          ) : null}

          <PrimaryButton
            label={submitLabel}
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
  'autoCapitalize' | 'maxLength' | 'multiline'
> {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  error?: string;
  required?: boolean;
  helperText?: string;
  large?: boolean;
}

function FormInput({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  required = false,
  helperText,
  multiline = false,
  large = false,
  autoCapitalize,
  maxLength,
}: FormInputProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoCapitalize={autoCapitalize}
        autoCorrect={multiline}
        maxLength={maxLength}
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
        <Text accessibilityRole="alert" style={styles.fieldError}>
          {error}
        </Text>
      ) : helperText ? (
        <Text style={styles.helperText}>{helperText}</Text>
      ) : null}
    </View>
  );
}

function CaseNumberFields({
  caseType,
  caseSerial,
  caseYear,
  errors,
  onChange,
}: {
  caseType: string;
  caseSerial: string;
  caseYear: string;
  errors: CaseFormErrors;
  onChange: (key: 'caseType' | 'caseSerial' | 'caseYear', value: string) => void;
}) {
  const fields = [
    { key: 'caseType' as const, label: 'Case Type', placeholder: 'LST', keyboardType: 'default' as const },
    { key: 'caseSerial' as const, label: 'Number', placeholder: '45', keyboardType: 'number-pad' as const },
    { key: 'caseYear' as const, label: 'Year', placeholder: '22', keyboardType: 'number-pad' as const },
  ];
  const values = { caseType, caseSerial, caseYear };
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>Case Number <Text style={styles.required}>*</Text></Text>
      <View style={styles.caseNumberRow}>
        {fields.map((field, index) => (
          <View key={field.key} style={styles.caseNumberPart}>
            <Text style={styles.partLabel}>{field.label}</Text>
            <TextInput
              value={values[field.key]}
              onChangeText={(value) => onChange(field.key, value)}
              placeholder={field.placeholder}
              placeholderTextColor={colors.textMuted}
              keyboardType={field.keyboardType}
              autoCapitalize={field.key === 'caseType' ? 'characters' : 'none'}
              maxLength={field.key === 'caseType' ? 40 : 12}
              style={[styles.input, errors[field.key] && styles.inputError]}
              accessibilityLabel={field.label}
            />
            {index < fields.length - 1 ? <Text style={styles.partSeparator}>{index === 0 ? '' : '/'}</Text> : null}
          </View>
        ))}
      </View>
      {errors.caseType || errors.caseSerial || errors.caseYear ? (
        <Text accessibilityRole="alert" style={styles.fieldError}>{errors.caseType ?? errors.caseSerial ?? errors.caseYear}</Text>
      ) : <Text style={styles.helperText}>Format: Case Type + Number / Year (for example LST 45/22)</Text>}
    </View>
  );
}

function validateCaseForm(values: CaseFormValues): CaseFormErrors {
  const errors: CaseFormErrors = {};
  const requiredFields: readonly [keyof CaseFormValues, string][] = [
    ['caseTitle', 'Case title'],
    ['caseType', 'Case type'],
    ['caseSerial', 'Case number'],
    ['caseYear', 'Case year'],
    ['partyName', 'Party name'],
    ['courtName', 'Court name'],
    ['representedSide', 'Represented side'],
  ];

  for (const [field, label] of requiredFields) {
    const value = values[field];
    if (typeof value === 'string' && !value.trim()) {
      errors[field] = `${label} is required.`;
    }
  }

  if (values.previousDate.trim() && !isValidDateOnly(values.previousDate.trim())) {
    errors.previousDate = 'Enter a valid date in YYYY-MM-DD format.';
  }
  if (values.nextDate.trim() && !isValidDateOnly(values.nextDate.trim())) {
    errors.nextDate = 'Enter a valid date in YYYY-MM-DD format.';
  }

  return errors;
}

function toCreateCaseInput(values: CaseFormValues): CreateCaseInput {
  const optionalText = (value: string) => value.trim() || null;

  return {
    caseTitle: values.caseTitle.trim(),
    caseNumber: buildCaseNumber(values.caseType, values.caseSerial, values.caseYear),
    caseType: values.caseType.trim(),
    caseSerial: values.caseSerial.trim(),
    caseYear: values.caseYear.trim(),
    partyName: values.partyName.trim(),
    oppositePartyName: values.oppositePartyName.trim(),
    representedSide: values.representedSide || null,
    courtName: values.courtName.trim(),
    judgeName: optionalText(values.judgeName),
    previousDate: optionalText(values.previousDate),
    nextDate: optionalText(values.nextDate),
    previousOrder: optionalText(values.previousOrder),
    nextStep: optionalText(values.nextStep),
    status: values.status,
    notes: optionalText(values.notes),
  };
}

function toTitleCase(value: CaseStatus): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    gap: spacing.xxl,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
  },
  sectionFields: {
    gap: spacing.lg,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  field: {
    gap: spacing.sm,
  },
  fieldLabel: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  required: {
    color: colors.danger,
  },
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
  multilineInput: {
    minHeight: 96,
  },
  largeInput: {
    minHeight: 140,
  },
  inputError: {
    borderColor: colors.danger,
  },
  fieldError: {
    ...typography.caption,
    color: colors.danger,
  },
  helperText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  caseNumberRow: { flexDirection: 'row', gap: spacing.sm },
  caseNumberPart: { flex: 1, gap: spacing.xs, position: 'relative' },
  partLabel: { ...typography.caption, color: colors.textMuted },
  partSeparator: { position: 'absolute', right: -7, bottom: 14, zIndex: 2, ...typography.bodyStrong, color: colors.textMuted },
  statusOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statusOption: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  statusOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  activeDot: {
    backgroundColor: colors.active,
  },
  pendingDot: {
    backgroundColor: colors.pending,
  },
  closedDot: {
    backgroundColor: colors.closed,
  },
  statusLabel: {
    ...typography.bodyStrong,
    color: colors.textMuted,
  },
  statusLabelSelected: {
    color: colors.primary,
  },
  submissionError: {
    ...typography.body,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerBackground,
    color: colors.danger,
  },
  pressed: {
    opacity: 0.78,
  },
});
