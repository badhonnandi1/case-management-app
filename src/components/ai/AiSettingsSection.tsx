import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { AI_FREE_TIER_PRIVACY_NOTICE, type AiPublicConfigDto } from '../../../shared/aiAnswerContract';
import { type AiBackendAvailability, wakeAiBackendAvailability } from '../../services/aiBackendAvailabilityService';
import { validateAiBackendUrl } from '../../services/aiBackendConfig';
import { resetAiOnlineConsent } from '../../services/aiOnlineConsentService';
import { AiPublicConfigError } from '../../services/aiPublicConfigService';
import {
  deleteAllLocalAiChats,
  deleteAllLocalAiIndexes,
  getAiSettingsSnapshot,
  refreshAiPublicConfiguration,
  selectAiModel,
  type AiSettingsSnapshot,
} from '../../services/aiSettingsService';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/spacing';
import { typography } from '../../theme/typography';
import { formatDisplayDateTime } from '../../utils/date';
import { AppCard } from '../AppCard';

interface AiSettingsSectionProps {
  onOpenAi: () => void;
}

type ConnectionState =
  | { status: 'unchecked' }
  | { status: 'checking' }
  | { status: 'starting'; attempt: number }
  | { status: 'result'; availability: AiBackendAvailability }
  | { status: 'error'; message: string };

export function AiSettingsSection({ onOpenAi }: AiSettingsSectionProps) {
  const [snapshot, setSnapshot] = useState<AiSettingsSnapshot | null>(null);
  const [publicConfig, setPublicConfig] = useState<AiPublicConfigDto | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [backendHost, setBackendHost] = useState(() => configuredBackendHost());
  const [connection, setConnection] = useState<ConnectionState>({ status: 'unchecked' });
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const connectionController = useRef<AbortController | null>(null);

  const reloadLocal = useCallback(async () => {
    try {
      setSnapshot(await getAiSettingsSnapshot());
    } catch {
      setConnection({ status: 'error', message: 'Local AI statistics could not be loaded.' });
    }
  }, []);

  const refreshConfiguration = useCallback(async () => {
    if (busyAction) return;
    setBusyAction('refresh');
    setConnection({ status: 'checking' });
    try {
      const result = await refreshAiPublicConfiguration();
      setPublicConfig(result.config);
      setSelectedModelId(result.selectedModelId);
      setBackendHost(result.backendHost);
      setConnection({
        status: 'result',
        availability: result.config.features.onlineAnswers
          ? { status: 'healthy' }
          : { status: 'provider_not_configured' },
      });
      if (result.selectionChanged) {
        Alert.alert('AI model updated', `The previous model is no longer allowed. ${result.selectedModelId} is now selected.`);
      }
      await reloadLocal();
    } catch (error) {
      setConnection({ status: 'error', message: safeConfigurationError(error) });
      await reloadLocal();
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, reloadLocal]);

  useEffect(() => {
    void reloadLocal();
    return () => connectionController.current?.abort();
  }, [reloadLocal]);

  async function testConnection() {
    if (busyAction) return;
    connectionController.current?.abort();
    const controller = new AbortController();
    connectionController.current = controller;
    setBusyAction('test');
    setConnection({ status: 'starting', attempt: 1 });
    try {
      const availability = await wakeAiBackendAvailability({
        signal: controller.signal,
        onProgress: ({ attempt }) => {
          if (!controller.signal.aborted) setConnection({ status: 'starting', attempt });
        },
      });
      if (controller.signal.aborted) return;
      setConnection({ status: 'result', availability });
      if (availability.status === 'healthy') await refreshConfigurationAfterHealth();
    } catch {
      if (!controller.signal.aborted) {
        setConnection({ status: 'error', message: 'The AI service could not be started. Local search remains available.' });
      }
    } finally {
      if (connectionController.current === controller) {
        connectionController.current = null;
        setBusyAction(null);
      }
    }
  }

  async function refreshConfigurationAfterHealth() {
    try {
      const result = await refreshAiPublicConfiguration();
      setPublicConfig(result.config);
      setSelectedModelId(result.selectedModelId);
      setBackendHost(result.backendHost);
      await reloadLocal();
    } catch (error) {
      setConnection({ status: 'error', message: safeConfigurationError(error) });
    }
  }

  async function chooseModel(modelId: string) {
    if (!publicConfig || busyAction) return;
    setBusyAction('model');
    try {
      await selectAiModel(publicConfig, modelId);
      setSelectedModelId(modelId);
    } catch {
      Alert.alert('Model unavailable', 'Refresh the backend configuration and choose an allowed model.');
    } finally {
      setBusyAction(null);
    }
  }

  function confirmResetConsent() {
    Alert.alert('Reset Online Consent?', 'Future online questions will require consent again. Chats and indexes will remain.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset Consent', style: 'destructive', onPress: () => void performResetConsent() },
    ]);
  }

  async function performResetConsent() {
    try {
      await resetAiOnlineConsent();
      Alert.alert('Online consent reset', 'No local chat, case, document, or index was deleted.');
    } catch {
      Alert.alert('Unable to reset consent', 'No local data was changed.');
    }
  }

  function confirmDeleteChats() {
    Alert.alert('Delete All Local AI Chats?', 'Prepared chat threads, messages, and citations will be deleted. Cases, original documents, and reusable indexes will remain.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete Chats', style: 'destructive', onPress: () => void performDeleteChats() },
    ]);
  }

  async function performDeleteChats() {
    setBusyAction('delete-chats');
    try {
      const count = await deleteAllLocalAiChats();
      await reloadLocal();
      Alert.alert('Local AI chats deleted', `${count} thread${count === 1 ? '' : 's'} removed. Reusable indexes and original documents remain.`);
    } catch {
      Alert.alert('Unable to delete chats', 'No cases or original documents were changed.');
    } finally {
      setBusyAction(null);
    }
  }

  function confirmDeleteIndexes() {
    Alert.alert('Delete All Local AI Indexes?', 'Derived text chunks and search indexes will be removed. Original documents, case records, and chats remain, but old citations may become stale.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete Indexes', style: 'destructive', onPress: () => void performDeleteIndexes() },
    ]);
  }

  async function performDeleteIndexes() {
    setBusyAction('delete-indexes');
    try {
      const count = await deleteAllLocalAiIndexes();
      await reloadLocal();
      Alert.alert('Local AI indexes deleted', `${count} derived source index${count === 1 ? '' : 'es'} removed. Original files remain.`);
    } catch {
      Alert.alert('Unable to delete indexes', 'No original case or document data was changed.');
    } finally {
      setBusyAction(null);
    }
  }

  const connectionDescription = describeConnection(connection);
  const lastCheck = snapshot?.lastSuccessfulConnectionAt
    ? formatDisplayDateTime(snapshot.lastSuccessfulConnectionAt)
    : 'Never';

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>AI ASSISTANT</Text>
      <AppCard style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.iconContainer}><Ionicons name="sparkles-outline" size={21} color={colors.primary} /></View>
          <View style={styles.grow}>
            <Text style={styles.title}>Online answers and local AI data</Text>
            <Text style={styles.description}>The Gemini key is managed only by the backend administrator.</Text>
          </View>
        </View>

        <View style={styles.statusBox} accessibilityRole="summary">
          <InfoRow label="Online AI" value={publicConfig?.features.onlineAnswers ? 'Enabled by backend' : 'Unavailable or not checked'} />
          <InfoRow label="Connection" value={connectionDescription} />
          <InfoRow label="Backend host" value={backendHost ?? 'Not configured'} />
          <InfoRow label="Provider" value={publicConfig?.providerDisplayName ?? 'Not checked'} />
          <InfoRow label="Selected model" value={selectedModelId ?? 'Backend default'} />
          <InfoRow label="Default model" value={publicConfig?.defaultModelId ?? 'Not checked'} />
          <InfoRow label="Processing policy" value={publicConfig?.privacy.processingTier === 'free_conservative' ? 'Free tier · conservative warning' : 'Not checked'} />
          <InfoRow label="Last successful check" value={lastCheck} />
        </View>

        {connection.status === 'starting' || connection.status === 'checking' ? (
          <View style={styles.loadingRow} accessibilityRole="progressbar" accessibilityLabel={connection.status === 'starting' ? 'Starting AI service' : 'Refreshing AI configuration'}><ActivityIndicator color={colors.primary} /><Text style={styles.description}>{connection.status === 'starting' ? `Starting AI service—this may take up to a minute. Health check ${connection.attempt}…` : 'Refreshing the configured backend…'}</Text></View>
        ) : null}

        <View style={styles.actionRow}>
          <SmallButton label="Test Connection" icon="pulse-outline" disabled={Boolean(busyAction)} onPress={() => void testConnection()} />
          <SmallButton label="Refresh Configuration" icon="refresh-outline" disabled={Boolean(busyAction)} onPress={() => void refreshConfiguration()} />
        </View>

        {publicConfig ? (
          <View style={styles.modelSection}>
            <Text style={styles.title}>Backend-approved models</Text>
            <Text style={styles.description}>Only this allowlist can be selected. The app cannot add arbitrary model IDs.</Text>
            {publicConfig.allowedModels.map((model) => {
              const selected = selectedModelId === model.id;
              return (
                <Pressable
                  key={model.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, disabled: Boolean(busyAction) }}
                  disabled={Boolean(busyAction)}
                  onPress={() => void chooseModel(model.id)}
                  style={({ pressed }) => [styles.modelRow, selected && styles.modelSelected, pressed && styles.pressed]}
                >
                  <View style={styles.grow}><Text style={styles.modelName}>{model.displayName}</Text><Text style={styles.modelId}>{model.id}{model.id === publicConfig.defaultModelId ? ' · default' : ''}</Text></View>
                  <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? colors.primary : colors.textMuted} />
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.privacyBox} accessibilityRole="alert">
          <Text style={styles.privacyTitle}>Current online-data notice</Text>
          <Text style={styles.privacyText}>{publicConfig?.privacy.notice ?? AI_FREE_TIER_PRIVACY_NOTICE}</Text>
        </View>

        <View style={styles.statusBox}>
          <InfoRow label="Local threads" value={String(snapshot?.local.threadCount ?? 0)} />
          <InfoRow label="Local messages" value={String(snapshot?.local.messageCount ?? 0)} />
          <InfoRow label="Ready indexed documents" value={String(snapshot?.local.indexedDocumentCount ?? 0)} />
          <InfoRow label="All source records" value={String(snapshot?.local.sourceCount ?? 0)} />
          <InfoRow label="AI storage size" value="Shared database · separate byte total unavailable" />
        </View>

        <SettingsAction label="Open Local AI Data Management" icon="folder-open-outline" onPress={onOpenAi} />
        <SettingsAction label="View AI Privacy Explanation" icon="shield-checkmark-outline" onPress={() => Alert.alert('AI privacy', `${publicConfig?.privacy.notice ?? AI_FREE_TIER_PRIVACY_NOTICE}\n\nOriginal PDFs, images, and local paths remain on this device. Local indexing and search do not upload content.`)} />
        <SettingsAction label="Administrator Key-Rotation Instructions" icon="key-outline" onPress={() => Alert.alert('Backend key rotation', 'There is no key field in this app. An administrator creates a new Gemini key, replaces the secret environment value directly in the Render Dashboard, deploys the reviewed service, verifies one synthetic request, and only then revokes the old key.')} />
        <SettingsAction label="Reset Online Consent" icon="refresh-circle-outline" destructive onPress={confirmResetConsent} />
        <SettingsAction label="Delete All Local AI Chats" icon="chatbubbles-outline" destructive disabled={Boolean(busyAction)} onPress={confirmDeleteChats} />
        <SettingsAction label="Delete All Local AI Indexes" icon="trash-bin-outline" destructive disabled={Boolean(busyAction)} onPress={confirmDeleteIndexes} />
      </AppCard>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text selectable style={styles.infoValue}>{value}</Text></View>;
}

function SmallButton({ label, icon, disabled, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.smallButton, pressed && styles.pressed, disabled && styles.disabled]}><Ionicons name={icon} size={18} color={colors.primary} /><Text style={styles.smallButtonText}>{label}</Text></Pressable>;
}

function SettingsAction({ label, icon, destructive = false, disabled = false, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; destructive?: boolean; disabled?: boolean; onPress: () => void }) {
  const color = destructive ? colors.danger : colors.primary;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.settingsAction, pressed && styles.pressed, disabled && styles.disabled]}><Ionicons name={icon} size={19} color={color} /><Text style={[styles.actionText, { color }]}>{label}</Text><Ionicons name="chevron-forward" size={17} color={colors.textMuted} /></Pressable>;
}

function configuredBackendHost(): string | null {
  const result = validateAiBackendUrl(process.env.EXPO_PUBLIC_AI_BACKEND_URL, !__DEV__);
  return result.configured ? new URL(result.baseUrl).host : null;
}

function describeConnection(state: ConnectionState): string {
  if (state.status === 'unchecked') return 'Not checked';
  if (state.status === 'checking') return 'Refreshing configuration';
  if (state.status === 'starting') return 'Starting AI service—this may take up to a minute';
  if (state.status === 'error') return state.message;
  const labels: Record<AiBackendAvailability['status'], string> = {
    healthy: 'Backend available',
    provider_not_configured: 'Backend reachable · online answers disabled',
    device_offline: 'Device offline',
    not_configured: 'Backend URL missing',
    invalid_configuration: 'Backend URL invalid',
    backend_unreachable: 'Backend unreachable',
    timed_out: 'Connection timed out',
    invalid_response: 'Backend response invalid',
  };
  return labels[state.availability.status];
}

function safeConfigurationError(error: unknown): string {
  if (!(error instanceof AiPublicConfigError)) return 'AI configuration could not be refreshed.';
  const messages: Record<AiPublicConfigError['code'], string> = {
    NOT_CONFIGURED: 'Backend URL missing',
    INVALID_CONFIGURATION: 'Backend URL invalid or insecure',
    DEVICE_OFFLINE: 'Device offline',
    TIMED_OUT: 'Configuration request timed out',
    UNREACHABLE: 'Backend unreachable',
    INVALID_RESPONSE: 'Backend configuration incompatible',
  };
  return messages[error.code];
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  sectionTitle: { ...typography.label, color: colors.textMuted },
  card: { gap: spacing.md, paddingVertical: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconContainer: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primarySoft },
  grow: { flex: 1 },
  title: { ...typography.bodyStrong, color: colors.text },
  description: { ...typography.caption, marginTop: spacing.xs, color: colors.textMuted },
  statusBox: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.background },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  infoLabel: { ...typography.caption, flex: 1, color: colors.textMuted },
  infoValue: { ...typography.caption, flex: 1.4, textAlign: 'right', color: colors.text },
  loadingRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  smallButton: { minHeight: 48, flexGrow: 1, flexBasis: 140, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  smallButtonText: { ...typography.caption, fontWeight: '600', color: colors.primary },
  modelSection: { gap: spacing.sm },
  modelRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  modelSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  modelName: { ...typography.bodyStrong, color: colors.text },
  modelId: { ...typography.caption, marginTop: spacing.xs, color: colors.textMuted },
  privacyBox: { gap: spacing.xs, padding: spacing.md, borderWidth: 1, borderColor: colors.pending, borderRadius: radius.md, backgroundColor: colors.pendingBackground },
  privacyTitle: { ...typography.bodyStrong, color: colors.pending },
  privacyText: { ...typography.caption, color: colors.text },
  settingsAction: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  actionText: { ...typography.body, flex: 1 },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.48 },
});
