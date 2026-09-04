import {
  AI_CONSENT_VERSION,
  AI_FREE_TIER_PRIVACY_NOTICE,
} from '../../shared/aiAnswerContract';
import { deleteSetting, getSettingValue, setSetting } from '../repositories/settingsRepository';

const AI_ONLINE_CONSENT_SETTING = 'ai_online_consent_context';

// This conservative declaration is trusted app code, not an EXPO_PUBLIC flag.
// Prompt 5 may replace it only after a backend-controlled tier/policy mechanism
// has been verified. A client environment variable must never upgrade the claim.
export const AI_ONLINE_DATA_POLICY = {
  provider: 'Gemini API',
  tier: 'free',
  context: AI_CONSENT_VERSION,
  warning: AI_FREE_TIER_PRIVACY_NOTICE,
} as const;

export async function hasCurrentAiOnlineConsent(context: string = AI_ONLINE_DATA_POLICY.context): Promise<boolean> {
  return (await getSettingValue(AI_ONLINE_CONSENT_SETTING, '')) === context;
}

export async function recordCurrentAiOnlineConsent(context: string = AI_ONLINE_DATA_POLICY.context): Promise<void> {
  await setSetting(AI_ONLINE_CONSENT_SETTING, context);
}

export async function resetAiOnlineConsent(): Promise<boolean> {
  return deleteSetting(AI_ONLINE_CONSENT_SETTING);
}
