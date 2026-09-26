import {
  AI_CONSENT_VERSION,
  AI_PRIVACY_POLICY_ID,
} from '../../../shared/aiAnswerContract.js';
import type { WorkerEnv } from './types.js';

export interface WorkerConfig {
  onlineAnswersEnabled: boolean;
  publicModelId: string;
  publicModelName: string;
  geminiModel: string;
  groqFallbackModel: string;
  fallbackEnabled: boolean;
  privacyPolicyId: string;
  consentPolicyVersion: string;
  answerRateLimitPerMinute: number;
  dailyPerTesterLimit: number;
  dailyGlobalLimit: number;
  maxOutputTokens: number;
  sessionTtlSeconds: number;
  providerTimeoutMs: number;
  circuitFailureThreshold: number;
  circuitOpenSeconds: number;
  geminiApiKey: string | null;
  groqApiKey: string | null;
  sessionSigningSecret: string | null;
}

const PUBLIC_MODEL_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;
const PROVIDER_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const POLICY_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

export function loadWorkerConfig(env: WorkerEnv): WorkerConfig {
  const publicModelId = stringValue(env.AI_PUBLIC_MODEL_ID, 'balanced');
  const publicModelName = stringValue(env.AI_PUBLIC_MODEL_NAME, 'Balanced');
  const geminiModel = stringValue(env.GEMINI_DEFAULT_MODEL, 'gemini-3.8-flash');
  const groqFallbackModel = stringValue(env.GROQ_FALLBACK_MODEL, 'openai/gpt-oss-20b');
  const privacyPolicyId = stringValue(env.AI_PRIVACY_POLICY_ID, AI_PRIVACY_POLICY_ID);
  const consentPolicyVersion = stringValue(env.AI_CONSENT_POLICY_VERSION, AI_CONSENT_VERSION);
  if (!PUBLIC_MODEL_PATTERN.test(publicModelId)) throw new Error('AI_PUBLIC_MODEL_ID is invalid.');
  if (!publicModelName || publicModelName.length > 80) throw new Error('AI_PUBLIC_MODEL_NAME is invalid.');
  if (!PROVIDER_MODEL_PATTERN.test(geminiModel)) throw new Error('GEMINI_DEFAULT_MODEL is invalid.');
  if (!PROVIDER_MODEL_PATTERN.test(groqFallbackModel)) throw new Error('GROQ_FALLBACK_MODEL is invalid.');
  if (!POLICY_PATTERN.test(privacyPolicyId) || !POLICY_PATTERN.test(consentPolicyVersion)) {
    throw new Error('AI privacy policy configuration is invalid.');
  }
  return {
    onlineAnswersEnabled: booleanValue(env.AI_ONLINE_ENABLED, true),
    publicModelId,
    publicModelName,
    geminiModel,
    groqFallbackModel,
    fallbackEnabled: booleanValue(env.AI_FALLBACK_ENABLED, true),
    privacyPolicyId,
    consentPolicyVersion,
    answerRateLimitPerMinute: integerValue(env.ANSWER_RATE_LIMIT_PER_MINUTE, 3, 1, 60),
    dailyPerTesterLimit: integerValue(env.AI_DAILY_PER_TESTER_LIMIT, 10, 1, 1_000),
    dailyGlobalLimit: integerValue(env.AI_DAILY_GLOBAL_LIMIT, 50, 1, 10_000),
    maxOutputTokens: integerValue(env.AI_MAX_OUTPUT_TOKENS, 1_024, 128, 4_096),
    sessionTtlSeconds: integerValue(env.SESSION_TTL_SECONDS, 900, 60, 86_400),
    providerTimeoutMs: integerValue(env.PROVIDER_TIMEOUT_MS, 30_000, 1_000, 60_000),
    circuitFailureThreshold: integerValue(env.PROVIDER_CIRCUIT_FAILURE_THRESHOLD, 2, 1, 10),
    circuitOpenSeconds: integerValue(env.PROVIDER_CIRCUIT_OPEN_SECONDS, 30, 5, 120),
    geminiApiKey: secretValue(env.GEMINI_API_KEY),
    groqApiKey: secretValue(env.GROQ_API_KEY),
    sessionSigningSecret: secretValue(env.SESSION_SIGNING_SECRET),
  };
}

export function workerProvidersConfigured(config: WorkerConfig): boolean {
  return config.onlineAnswersEnabled
    && config.geminiApiKey !== null
    && (!config.fallbackEnabled || config.groqApiKey !== null);
}

function stringValue(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

function secretValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('Boolean Worker configuration must be true or false.');
}

function integerValue(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error('Integer Worker configuration is outside its allowed range.');
  }
  return parsed;
}
