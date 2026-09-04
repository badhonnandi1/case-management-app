import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';
import { AI_ONLINE_DATA_POLICY } from '../../services/aiOnlineConsentService';
import { PrimaryButton } from '../PrimaryButton';

interface AiOnlineConsentProps {
  visible: boolean;
  evidence?: readonly {
    documentName: string;
    pageLabel: string;
    excerpt: string;
  }[];
  providerDisplayName?: string;
  privacyNotice?: string;
  onCancel: () => void;
  onConsent: () => void;
}

export function AiOnlineConsent({
  visible,
  evidence = [],
  providerDisplayName = 'Google Gemini',
  privacyNotice = AI_ONLINE_DATA_POLICY.warning,
  onCancel,
  onConsent,
}: AiOnlineConsentProps) {
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (visible) setAccepted(false);
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.title}>Before using an online AI answer</Text>
            <Text style={styles.body}>
              Relevant excerpts will be sent to the configured {providerDisplayName} backend. Original PDFs and images are not uploaded, but excerpts may contain confidential legal information.
            </Text>
            {evidence.length > 0 ? (
              <View style={styles.preview}>
                <Text style={styles.scope}>Excerpts queued for this request ({evidence.length})</Text>
                {evidence.map((item, index) => (
                  <View key={`${item.documentName}-${item.pageLabel}-${index}`} style={styles.previewItem}>
                    <Text style={styles.previewTitle}>[{index + 1}] {item.documentName} · {item.pageLabel}</Text>
                    <Text style={styles.previewText}>{createConsentPreview(item.excerpt)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            <View style={styles.warning} accessibilityRole="alert">
              <Text style={styles.warningTitle}>Current online-data policy · Gemini API free tier</Text>
              <Text style={styles.warningText}>{privacyNotice}</Text>
            </View>
            <Text style={styles.body}>
              Selecting or preparing a document does not upload it. Local case management, preparation, and search continue to work without online AI.
            </Text>
            <Text style={styles.body}>
              AI answers may be incomplete or incorrect. Verify every answer against the cited source documents and do not treat it as professional legal advice.
            </Text>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: accepted }}
              onPress={() => setAccepted((value) => !value)}
              style={styles.checkRow}
            >
              <View style={[styles.checkbox, accepted && styles.checkboxAccepted]}>
                {accepted ? <Text style={styles.checkmark}>✓</Text> : null}
              </View>
              <Text style={styles.checkText}>I am authorized to send these selected excerpts and accept the current online-data policy.</Text>
            </Pressable>
          </ScrollView>
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={onCancel} style={styles.cancelButton}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <View style={styles.primaryAction}>
              <PrimaryButton label="Agree and Continue" disabled={!accepted} onPress={onConsent} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.45)' },
  sheet: { maxHeight: '88%', borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, backgroundColor: colors.surface },
  content: { gap: spacing.md, padding: spacing.xl },
  title: { ...typography.heading, color: colors.text },
  body: { ...typography.body, color: colors.text },
  scope: { ...typography.bodyStrong, color: colors.primary },
  preview: { gap: spacing.sm },
  previewItem: { gap: spacing.xs, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.background },
  previewTitle: { ...typography.caption, fontWeight: '600', color: colors.text },
  previewText: { ...typography.caption, color: colors.textMuted },
  warning: { gap: spacing.xs, padding: spacing.md, borderWidth: 1, borderColor: colors.pending, borderRadius: radius.md, backgroundColor: colors.pendingBackground },
  warningTitle: { ...typography.bodyStrong, color: colors.pending },
  warningText: { ...typography.caption, color: colors.text },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.sm },
  checkbox: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.border, borderRadius: radius.sm },
  checkboxAccepted: { borderColor: colors.primary, backgroundColor: colors.primary },
  checkmark: { color: colors.surface, fontWeight: '700' },
  checkText: { ...typography.body, flex: 1, color: colors.text },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.xl, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  cancelButton: { minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.lg },
  cancelText: { ...typography.bodyStrong, color: colors.textMuted },
  primaryAction: { flex: 1 },
});

function createConsentPreview(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= 320 ? normalized : `${normalized.slice(0, 319).trimEnd()}…`;
}
