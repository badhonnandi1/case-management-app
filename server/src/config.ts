import { z } from 'zod';

import { AI_CONSENT_VERSION, AI_PRIVACY_POLICY_ID } from '../../shared/aiAnswerContract.js';

export interface ServerConfig {
  host: string;
  port: number;
  production: boolean;
  trustProxy: boolean;
  allowedOrigins: readonly string[];
  providerTimeoutMs: number;
  answerRateLimitPerMinute: number;
  ipRateLimitPerMinute: number;
  sessionIssueLimitPerMinute: number;
  sessionTtlSeconds: number;
  sessionSigningSecret: string | null;
  onlineAnswersEnabled: boolean;
  geminiApiKey: string | null;
  geminiDefaultModel: string;
  geminiAllowedModels: readonly string[];
  privacyPolicyId: string;
  consentPolicyVersion: string;
}

const modelId = z.string().trim().regex(/^gemini-[a-z0-9.-]+$/);

const environmentSchema = z.object({
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: integer(8787, 1, 65_535),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TRUST_PROXY: booleanValue(false),
  ALLOWED_ORIGINS: z.string().default(''),
  PROVIDER_TIMEOUT_MS: integer(30_000, 1_000, 120_000),
  ANSWER_RATE_LIMIT_PER_MINUTE: integer(10, 1, 1_000),
  IP_RATE_LIMIT_PER_MINUTE: integer(30, 1, 10_000),
  SESSION_ISSUE_LIMIT_PER_MINUTE: integer(10, 1, 1_000),
  SESSION_TTL_SECONDS: integer(900, 60, 86_400),
  SESSION_SIGNING_SECRET: z.string().trim().min(43).max(256).regex(/^[A-Za-z0-9_-]+$/).optional(),
  AI_ONLINE_ENABLED: booleanValue(true),
  GEMINI_API_KEY: z.string().trim().min(1).optional(),
  GEMINI_DEFAULT_MODEL: modelId.optional(),
  GEMINI_ALLOWED_MODELS: z.string().trim().optional(),
  // Compatibility with the Prompt 3 deployment variable. New deployments should use GEMINI_DEFAULT_MODEL.
  GEMINI_MODEL: modelId.optional(),
  AI_PRIVACY_POLICY_ID: z.string().trim().min(8).max(128).regex(/^[a-z0-9._-]+$/).default(AI_PRIVACY_POLICY_ID),
  AI_CONSENT_POLICY_VERSION: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._-]+$/).default(AI_CONSENT_VERSION),
}).strict();

export function loadServerConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = environmentSchema.parse(selectEnvironment(environment));
  const allowedOrigins = parsed.ALLOWED_ORIGINS
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map(validateOrigin);
  const geminiDefaultModel = parsed.GEMINI_DEFAULT_MODEL ?? parsed.GEMINI_MODEL ?? 'gemini-3.8-flash';
  const geminiAllowedModels = parseAllowedModels(parsed.GEMINI_ALLOWED_MODELS, geminiDefaultModel);
  if (parsed.NODE_ENV === 'production' && !parsed.SESSION_SIGNING_SECRET) {
    throw new Error('SESSION_SIGNING_SECRET is required in production.');
  }
  if (parsed.NODE_ENV === 'production' && parsed.AI_ONLINE_ENABLED && !parsed.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is required when online answers are enabled in production.');
  }
  if (parsed.SESSION_SIGNING_SECRET && decodeSigningSecret(parsed.SESSION_SIGNING_SECRET).length < 32) {
    throw new Error('SESSION_SIGNING_SECRET must decode to at least 32 bytes.');
  }
  return {
    host: parsed.HOST,
    port: parsed.PORT,
    production: parsed.NODE_ENV === 'production',
    trustProxy: parsed.TRUST_PROXY,
    allowedOrigins,
    providerTimeoutMs: parsed.PROVIDER_TIMEOUT_MS,
    answerRateLimitPerMinute: parsed.ANSWER_RATE_LIMIT_PER_MINUTE,
    ipRateLimitPerMinute: parsed.IP_RATE_LIMIT_PER_MINUTE,
    sessionIssueLimitPerMinute: parsed.SESSION_ISSUE_LIMIT_PER_MINUTE,
    sessionTtlSeconds: parsed.SESSION_TTL_SECONDS,
    sessionSigningSecret: parsed.SESSION_SIGNING_SECRET ?? null,
    onlineAnswersEnabled: parsed.AI_ONLINE_ENABLED,
    geminiApiKey: parsed.GEMINI_API_KEY ?? null,
    geminiDefaultModel,
    geminiAllowedModels,
    privacyPolicyId: parsed.AI_PRIVACY_POLICY_ID,
    consentPolicyVersion: parsed.AI_CONSENT_POLICY_VERSION,
  };
}

function selectEnvironment(environment: NodeJS.ProcessEnv): Record<string, string | undefined> {
  return {
    HOST: environment.HOST,
    PORT: environment.PORT,
    NODE_ENV: environment.NODE_ENV,
    TRUST_PROXY: environment.TRUST_PROXY,
    ALLOWED_ORIGINS: environment.ALLOWED_ORIGINS,
    PROVIDER_TIMEOUT_MS: environment.PROVIDER_TIMEOUT_MS,
    ANSWER_RATE_LIMIT_PER_MINUTE: environment.ANSWER_RATE_LIMIT_PER_MINUTE,
    IP_RATE_LIMIT_PER_MINUTE: environment.IP_RATE_LIMIT_PER_MINUTE,
    SESSION_ISSUE_LIMIT_PER_MINUTE: environment.SESSION_ISSUE_LIMIT_PER_MINUTE,
    SESSION_TTL_SECONDS: environment.SESSION_TTL_SECONDS,
    SESSION_SIGNING_SECRET: environment.SESSION_SIGNING_SECRET,
    AI_ONLINE_ENABLED: environment.AI_ONLINE_ENABLED,
    GEMINI_API_KEY: environment.GEMINI_API_KEY,
    GEMINI_DEFAULT_MODEL: environment.GEMINI_DEFAULT_MODEL,
    GEMINI_ALLOWED_MODELS: environment.GEMINI_ALLOWED_MODELS,
    GEMINI_MODEL: environment.GEMINI_MODEL,
    AI_PRIVACY_POLICY_ID: environment.AI_PRIVACY_POLICY_ID,
    AI_CONSENT_POLICY_VERSION: environment.AI_CONSENT_POLICY_VERSION,
  };
}

export function decodeSigningSecret(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

function parseAllowedModels(value: string | undefined, defaultModel: string): string[] {
  const candidates = value
    ? value.split(',').map((item) => item.trim()).filter(Boolean)
    : [defaultModel, 'gemini-3.7-flash', 'gemini-3.5-flash-lite'];
  const unique = [...new Set(candidates)];
  if (!unique.includes(defaultModel)) unique.unshift(defaultModel);
  if (unique.length > 8 || unique.some((candidate) => !modelId.safeParse(candidate).success)) {
    throw new Error('GEMINI_ALLOWED_MODELS must contain at most eight valid Gemini model IDs.');
  }
  return unique;
}

function integer(defaultValue: number, minimum: number, maximum: number) {
  return z.preprocess(
    (value) => value === undefined || value === '' ? defaultValue : Number(value),
    z.number().int().min(minimum).max(maximum),
  );
}

function booleanValue(defaultValue: boolean) {
  return z.preprocess(
    (value) => value === undefined || value === '' ? defaultValue : value === 'true',
    z.boolean(),
  );
}

function validateOrigin(origin: string): string {
  const url = new URL(origin);
  if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('ALLOWED_ORIGINS must contain exact HTTP(S) origins.');
  }
  return origin;
}
