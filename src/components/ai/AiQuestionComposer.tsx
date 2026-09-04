import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AI_API_LIMITS } from '../../../shared/aiAnswerContract';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';
import { validateAiQuestion } from '../../utils/aiConversation';

interface AiQuestionComposerProps {
  value: string;
  active: boolean;
  cancellable: boolean;
  canSend: boolean;
  disabledReason: string | null;
  onChange: (value: string) => void;
  onSend: (question: string) => void;
  onCancel: () => void;
}

export function AiQuestionComposer(props: AiQuestionComposerProps) {
  const validation = validateAiQuestion(props.value);
  const tooLong = props.value.length > AI_API_LIMITS.questionCharacters;
  const sendDisabled = props.active || !props.canSend || !validation.valid;
  const explanation = tooLong
    ? validation.valid ? null : validation.message
    : props.disabledReason ?? (!validation.valid && props.value.length > 0 ? validation.message : null);

  return (
    <View style={styles.container}>
      <View style={[styles.inputShell, tooLong && styles.inputError]}>
        <TextInput
          value={props.value}
          onChangeText={props.onChange}
          editable={!props.active}
          multiline
          textAlignVertical="top"
          placeholder="Ask about the prepared documents…"
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Question for the prepared sources"
          accessibilityHint="Supports Bangla, English, and mixed-language questions"
          style={styles.input}
        />
        <Text style={[styles.count, tooLong && styles.countError]} accessibilityLabel={`${props.value.length} of ${AI_API_LIMITS.questionCharacters} characters`}>
          {props.value.length}/{AI_API_LIMITS.questionCharacters}
        </Text>
      </View>
      {explanation ? <Text accessibilityRole="alert" style={styles.explanation}>{explanation}</Text> : null}
      {props.active && props.cancellable ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Stop online answer request" onPress={props.onCancel} style={({ pressed }) => [styles.stopButton, pressed && styles.pressed]}>
          <Ionicons name="stop-circle-outline" size={20} color={colors.danger} />
          <Text style={styles.stopText}>Stop</Text>
        </Pressable>
      ) : props.active ? (
        <View accessibilityRole="progressbar" style={[styles.sendButton, styles.disabled]}><Text style={styles.sendText}>Saving validated answer…</Text></View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send question"
          accessibilityState={{ disabled: sendDisabled }}
          accessibilityHint={sendDisabled ? explanation ?? 'Enter a question to continue' : 'Searches locally before sending selected excerpts online'}
          disabled={sendDisabled}
          onPress={() => validation.valid && props.onSend(validation.question)}
          style={({ pressed }) => [styles.sendButton, pressed && styles.pressed, sendDisabled && styles.disabled]}
        >
          <Ionicons name="arrow-up" size={20} color={colors.surface} />
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surface },
  inputShell: { minHeight: 96, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.background },
  inputError: { borderColor: colors.danger },
  input: { minHeight: 58, padding: 0, color: colors.text, ...typography.body },
  count: { ...typography.caption, alignSelf: 'flex-end', color: colors.textMuted },
  countError: { color: colors.danger },
  explanation: { ...typography.caption, color: colors.textMuted },
  sendButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primary },
  sendText: { ...typography.bodyStrong, color: colors.surface },
  stopButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md },
  stopText: { ...typography.bodyStrong, color: colors.danger },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.76 },
});
