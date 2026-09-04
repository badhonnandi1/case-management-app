import type { AiPublicConfigDto } from '../../shared/aiAnswerContract';
import {
  deleteAllAiChats,
  getAiLocalStatistics,
  type AiLocalStatistics,
} from '../repositories/aiSettingsRepository';
import { getSettingValue, setSetting } from '../repositories/settingsRepository';
import { removeAllAiIndexes } from '../repositories/aiSourceRepository';
import { fetchAiPublicConfig, type AiPublicConfigResult } from './aiPublicConfigService';

const SELECTED_MODEL_SETTING = 'ai_selected_model_id';
const LAST_CONNECTION_SETTING = 'ai_last_successful_connection_at';

export interface AiSettingsSnapshot {
  local: AiLocalStatistics;
  lastSuccessfulConnectionAt: string | null;
}

export async function getAiSettingsSnapshot(): Promise<AiSettingsSnapshot> {
  const [local, lastSuccessfulConnectionAt] = await Promise.all([
    getAiLocalStatistics(),
    getSettingValue(LAST_CONNECTION_SETTING, ''),
  ]);
  return { local, lastSuccessfulConnectionAt: lastSuccessfulConnectionAt || null };
}

export async function refreshAiPublicConfiguration(
  signal?: AbortSignal,
): Promise<AiPublicConfigResult & { selectedModelId: string; selectionChanged: boolean }> {
  const result = await fetchAiPublicConfig({ signal });
  const selection = await resolveSelectedAiModel(result.config);
  await setSetting(LAST_CONNECTION_SETTING, result.checkedAt);
  return { ...result, ...selection };
}

export async function resolveSelectedAiModel(
  config: AiPublicConfigDto,
): Promise<{ selectedModelId: string; selectionChanged: boolean }> {
  const stored = await getSettingValue(SELECTED_MODEL_SETTING, '');
  const allowed = new Set(config.allowedModels.map((model) => model.id));
  const selectedModelId = allowed.has(stored) ? stored : config.defaultModelId;
  const selectionChanged = Boolean(stored) && stored !== selectedModelId;
  if (stored !== selectedModelId) await setSetting(SELECTED_MODEL_SETTING, selectedModelId);
  return { selectedModelId, selectionChanged };
}

export async function selectAiModel(config: AiPublicConfigDto, modelId: string): Promise<void> {
  if (!config.allowedModels.some((model) => model.id === modelId)) {
    throw new Error('The selected model is not in the backend allowlist.');
  }
  await setSetting(SELECTED_MODEL_SETTING, modelId);
}

export async function deleteAllLocalAiChats(): Promise<number> {
  return deleteAllAiChats();
}

export async function deleteAllLocalAiIndexes(): Promise<number> {
  return removeAllAiIndexes();
}
