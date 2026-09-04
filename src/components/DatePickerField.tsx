import Ionicons from '@expo/vector-icons/Ionicons';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { typography } from '../theme/typography';
import { isValidDateOnly, toLocalDateString } from '../utils/date';

interface DatePickerFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  helperText?: string;
  allowClear?: boolean;
}

export function DatePickerField({
  label,
  value,
  onChange,
  error,
  required = false,
  helperText,
  allowClear = true,
}: DatePickerFieldProps) {
  function openPicker() {
    DateTimePickerAndroid.open({
      value: toPickerDate(value),
      mode: 'date',
      display: 'spinner',
      onChange: (event, selectedDate) => {
        if (event.type === 'set' && selectedDate) onChange(toLocalDateString(selectedDate));
      },
    });
  }

  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}{required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      <View style={[styles.control, error && styles.controlError]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Select ${label}`}
          onPress={openPicker}
          style={({ pressed }) => [styles.selectButton, pressed && styles.pressed]}
        >
          <Ionicons name="calendar-outline" size={20} color={colors.primary} />
          <Text style={[styles.value, !value && styles.placeholder]}>
            {value || 'Select date'}
          </Text>
          <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
        </Pressable>
        {allowClear && value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label}`}
            onPress={() => onChange('')}
            hitSlop={8}
            style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
          >
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
        : helperText ? <Text style={styles.helper}>{helperText}</Text> : null}
    </View>
  );
}

function toPickerDate(value: string): Date {
  if (!isValidDateOnly(value)) return new Date();
  const [year = 0, month = 1, day = 1] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

const styles = StyleSheet.create({
  field: { gap: spacing.sm },
  label: { ...typography.bodyStrong, color: colors.text },
  required: { color: colors.danger },
  control: { minHeight: 48, flexDirection: 'row', alignItems: 'stretch', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  controlError: { borderColor: colors.danger },
  selectButton: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md },
  value: { ...typography.body, flex: 1, color: colors.text },
  placeholder: { color: colors.textMuted },
  clearButton: { minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.65 },
  error: { ...typography.caption, color: colors.danger },
  helper: { ...typography.caption, color: colors.textMuted },
});
