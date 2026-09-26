import {
  AI_API_LIMITS,
  AI_API_VERSION,
  AI_FREE_TIER_PRIVACY_NOTICE,
  AI_PROVIDER_DISPLAY_NAME,
  AI_SERVER_CONTRACT_VERSION,
  type AiAnswerResponseDto,
  type AiApiErrorResponseDto,
  type AiHealthResponseDto,
  type AiPublicConfigDto,
  type AiSessionResponseDto,
} from '../../../shared/aiAnswerContract.js';
import { answerRequestSchema } from '../contracts.js';
import { PublicApiError } from '../errors.js';
import { loadWorkerConfig, workerProvidersConfigured, type WorkerConfig } from './config.js';
import { sha256Base64Url, signSessionToken, validateSigningSecret, verifySessionToken } from './crypto.js';
import { WorkerProviderError } from './providerErrors.js';
import { WorkerProviderRouter, type RoutedProviderResult } from './providerRouter.js';
import { AnswerReservationError, WorkerSecurityStore } from './securityStore.js';
import { workerJsonLogger, type WorkerEnv, type WorkerOperationalLogEvent, type WorkerOperationalLogger } from './types.js';

export interface WorkerAppDependencies {
  logger?: WorkerOperationalLogger;
  now?: () => Date;
  routerFactory?: (config: WorkerConfig, store: WorkerSecurityStore) => ProviderRouterLike;
}

export interface ProviderRouterLike {
  answer(request: Parameters<WorkerProviderRouter['answer']>[0], signal: AbortSignal, nowSeconds: number): Promise<RoutedProviderResult>;
}

export function createWorkerApp(dependencies: WorkerAppDependencies = {}) {
  return async (request: Request, env: WorkerEnv): Promise<Response> => {
    const startedAt = performance.now();
    const serverRequestId = crypto.randomUUID();
    const url = new URL(request.url);
    const metrics: WorkerOperationalLogEvent = {
      serverRequestId,
      timestamp: new Date().toISOString(),
      endpoint: routeLabel(url.pathname),
      statusCode: 500,
      durationMs: 0,
      payloadBytes: null,
      evidenceCount: null,
      provider: null,
      fallbackUsed: false,
      errorCategory: null,
      inputTokens: null,
      outputTokens: null,
    };
    let response: Response;
    try {
      response = await routeRequest(request, env, serverRequestId, metrics, dependencies);
    } catch (error) {
      const publicError = toPublicError(error);
      if (error instanceof WorkerProviderError) {
        metrics.provider = error.provider;
        metrics.fallbackUsed = error.fallbackUsed;
        metrics.errorCategory = `${error.code}:${error.category}`;
      } else {
        metrics.errorCategory = publicError.code;
      }
      response = errorResponse(publicError, serverRequestId);
    }
    metrics.statusCode = response.status;
    metrics.durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    (dependencies.logger ?? workerJsonLogger).write(metrics);
    return withSecurityHeaders(response);
  };
}

async function routeRequest(
  request: Request,
  env: WorkerEnv,
  serverRequestId: string,
  metrics: WorkerOperationalLogEvent,
  dependencies: WorkerAppDependencies,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.headers.has('origin')) {
    throw new PublicApiError('UNAUTHORIZED', 403, 'Browser origins are not allowed.');
  }
  const config = loadWorkerConfig(env);
  const now = dependencies.now?.() ?? new Date();
  if (request.method === 'GET' && url.pathname === '/health') {
    return json(health(config), 200, { 'cache-control': 'no-store' });
  }
  if (request.method === 'GET' && url.pathname === '/api/v1/config') {
    return json(publicConfiguration(config), 200, { 'cache-control': 'public, max-age=60' });
  }
  if (request.method === 'POST' && url.pathname === '/api/v1/sessions') {
    return createSession(request, env, config, now);
  }
  if (request.method === 'POST' && url.pathname === '/api/v1/answers') {
    return createAnswer(request, env, config, now, serverRequestId, metrics, dependencies);
  }
  throw new PublicApiError('INVALID_REQUEST', 404, 'Route not found.');
}

function health(config: WorkerConfig): AiHealthResponseDto {
  const available = workerReady(config);
  return {
    status: available ? 'ok' : 'degraded',
    apiVersion: AI_API_VERSION,
    onlineAnswers: available ? 'available' : 'provider_not_configured',
  };
}

function publicConfiguration(config: WorkerConfig): AiPublicConfigDto {
  return {
    apiVersion: AI_API_VERSION,
    serverContractVersion: AI_SERVER_CONTRACT_VERSION,
    providerDisplayName: AI_PROVIDER_DISPLAY_NAME,
    defaultModelId: config.publicModelId,
    allowedModels: [{ id: config.publicModelId, displayName: config.publicModelName }],
    privacy: {
      policyId: config.privacyPolicyId,
      consentVersion: config.consentPolicyVersion,
      processingTier: 'free_conservative',
      notice: AI_FREE_TIER_PRIVACY_NOTICE,
      selectedExcerptsOnly: true,
      originalFilesUploaded: false,
    },
    limits: {
      questionCharacters: AI_API_LIMITS.questionCharacters,
      evidenceItems: AI_API_LIMITS.evidenceItems,
      requestsPerMinute: config.answerRateLimitPerMinute,
      requestsPerDay: config.dailyPerTesterLimit,
      globalRequestsPerDay: config.dailyGlobalLimit,
      maxOutputTokens: config.maxOutputTokens,
    },
    features: {
      onlineAnswers: workerReady(config),
      modelSelection: false,
      providerFallback: config.fallbackEnabled,
      streaming: false,
      testerInviteRequired: true,
    },
  };
}

async function createSession(request: Request, env: WorkerEnv, config: WorkerConfig, now: Date): Promise<Response> {
  requireReadyDatabase(env);
  requireSigningSecret(config);
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new PublicApiError('INVALID_REQUEST', 415, 'Content-Type must be application/json.');
  }
  const payloadText = await readLimitedBody(request, 512);
  let payload: unknown;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    throw new PublicApiError('UNAUTHORIZED', 401, 'A valid tester invite code is required.');
  }
  const inviteCode = sessionInviteCode(payload);
  if (inviteCode.length < 32 || inviteCode.length > 256) {
    throw new PublicApiError('UNAUTHORIZED', 401, 'A valid tester invite code is required.');
  }
  const store = new WorkerSecurityStore(env.DB);
  const tester = await store.findActiveTesterByCodeHash(await sha256Base64Url(inviteCode));
  if (!tester) throw new PublicApiError('UNAUTHORIZED', 401, 'A valid tester invite code is required.');
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  const session = await store.createSession(tester.id, nowSeconds, config.sessionTtlSeconds);
  const token = await signSessionToken(
    { sid: session.id, tid: session.testerId, exp: session.expiresAt },
    config.sessionSigningSecret!,
  );
  const body: AiSessionResponseDto = {
    sessionToken: token,
    expiresAt: new Date(session.expiresAt * 1_000).toISOString(),
  };
  return json(body, 201, { 'cache-control': 'no-store' });
}

function sessionInviteCode(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return '';
  const record = payload as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.inviteCode !== 'string') return '';
  return record.inviteCode.trim();
}

async function createAnswer(
  request: Request,
  env: WorkerEnv,
  config: WorkerConfig,
  now: Date,
  serverRequestId: string,
  metrics: WorkerOperationalLogEvent,
  dependencies: WorkerAppDependencies,
): Promise<Response> {
  requireReadyDatabase(env);
  requireSigningSecret(config);
  if (!workerProvidersConfigured(config)) {
    throw new PublicApiError('PROVIDER_NOT_CONFIGURED', 503, 'Online answers are not configured on this server.');
  }
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new PublicApiError('INVALID_REQUEST', 415, 'Content-Type must be application/json.');
  }
  const store = new WorkerSecurityStore(env.DB);
  const auth = await authorize(request, config, store, now);
  const payloadText = await readLimitedBody(request, AI_API_LIMITS.requestBytes);
  metrics.payloadBytes = new TextEncoder().encode(payloadText).byteLength;
  let payload: unknown;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    throw new PublicApiError('INVALID_REQUEST', 400, 'The request body must contain valid JSON.');
  }
  const validated = answerRequestSchema.safeParse(payload);
  if (!validated.success) throw classifyValidationError(payload);
  metrics.evidenceCount = validated.data.evidence.length;
  if (validated.data.consent.version !== config.consentPolicyVersion) {
    throw new PublicApiError('CONSENT_REQUIRED', 400, 'Consent must be renewed for the current online data policy.');
  }
  if (validated.data.modelId !== undefined && validated.data.modelId !== config.publicModelId) {
    throw new PublicApiError('MODEL_NOT_ALLOWED', 400, 'The selected model is not available. Refresh AI configuration and try again.');
  }
  await store.reserveAnswer({
    sessionId: auth.sessionId,
    testerId: auth.testerId,
    requestId: validated.data.requestId,
    fingerprint: await sha256Base64Url(payloadText),
    now,
    config,
  });

  const router = dependencies.routerFactory?.(config, store) ?? new WorkerProviderRouter(config, store);
  const routed = await router.answer(validated.data, request.signal, Math.floor(now.getTime() / 1_000));
  applyProviderMetrics(metrics, routed);
  const body: AiAnswerResponseDto = {
    requestId: validated.data.requestId,
    serverRequestId,
    ...routed.result,
  };
  return json(body, 200, {
    'cache-control': 'no-store',
    'x-ai-route': routed.fallbackUsed ? 'fallback' : 'primary',
  });
}

async function authorize(
  request: Request,
  config: WorkerConfig,
  store: WorkerSecurityStore,
  now: Date,
): Promise<{ sessionId: string; testerId: string }> {
  const authorization = request.headers.get('authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const payload = token && config.sessionSigningSecret
    ? await verifySessionToken(token, config.sessionSigningSecret)
    : null;
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  if (!payload || payload.exp <= nowSeconds) {
    throw new PublicApiError('UNAUTHORIZED', 401, 'A valid active tester session is required.');
  }
  const session = await store.getActiveSession(payload.sid, payload.tid, nowSeconds);
  if (!session) throw new PublicApiError('UNAUTHORIZED', 401, 'A valid active tester session is required.');
  return { sessionId: payload.sid, testerId: payload.tid };
}

async function readLimitedBody(request: Request, maximumBytes: number): Promise<string> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new PublicApiError('PAYLOAD_TOO_LARGE', 413, 'The request is too large.');
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new PublicApiError('PAYLOAD_TOO_LARGE', 413, 'The request is too large.');
  }
  return text;
}

function requireSigningSecret(config: WorkerConfig): void {
  if (!config.sessionSigningSecret || !validateSigningSecret(config.sessionSigningSecret)) {
    throw new PublicApiError('PROVIDER_NOT_CONFIGURED', 503, 'Online answers are not configured on this server.');
  }
}

function requireReadyDatabase(env: WorkerEnv): void {
  if (!env.DB) throw new PublicApiError('PROVIDER_NOT_CONFIGURED', 503, 'Online answers are not configured on this server.');
}

function workerReady(config: WorkerConfig): boolean {
  return workerProvidersConfigured(config)
    && config.sessionSigningSecret !== null
    && validateSigningSecret(config.sessionSigningSecret);
}

function applyProviderMetrics(metrics: WorkerOperationalLogEvent, routed: RoutedProviderResult): void {
  metrics.provider = routed.provider;
  metrics.fallbackUsed = routed.fallbackUsed;
  metrics.inputTokens = routed.result.usage.inputTokens;
  metrics.outputTokens = routed.result.usage.outputTokens;
}

function classifyValidationError(body: unknown): PublicApiError {
  if (typeof body === 'object' && body !== null) {
    const record = body as Record<string, unknown>;
    if (!record.consent || typeof record.consent !== 'object'
      || (record.consent as Record<string, unknown>).granted !== true) {
      return new PublicApiError('CONSENT_REQUIRED', 400, 'Explicit consent is required before evidence can be sent.');
    }
    if (!Array.isArray(record.selectedCaseIds) || !Array.isArray(record.selectedDocumentIds)
      || record.selectedCaseIds.length === 0 || record.selectedDocumentIds.length === 0) {
      return new PublicApiError('EMPTY_SCOPE', 400, 'At least one case and one document must be selected.');
    }
    if (!Array.isArray(record.evidence) || record.evidence.length === 0) {
      return new PublicApiError('EMPTY_EVIDENCE', 400, 'At least one evidence excerpt is required.');
    }
  }
  return new PublicApiError('INVALID_REQUEST', 400, 'The request is invalid or scope-inconsistent.');
}

function toPublicError(error: unknown): PublicApiError {
  if (error instanceof AnswerReservationError) {
    if (error.reason === 'REPLAY') return new PublicApiError('INVALID_REQUEST', 409, 'This request identifier has already been used.');
    if (error.reason === 'UNAUTHORIZED') return new PublicApiError('UNAUTHORIZED', 401, 'A valid active tester session is required.');
    if (error.reason === 'MINUTE') return new PublicApiError('RATE_LIMITED', 429, 'The per-minute testing limit has been reached.', 60);
    return new PublicApiError('RATE_LIMITED', 429, 'The daily testing limit has been reached.', secondsUntilUtcDay());
  }
  if (error instanceof WorkerProviderError || error instanceof PublicApiError) return error;
  return new PublicApiError('INTERNAL_ERROR', 500, 'The server could not complete the request.');
}

function secondsUntilUtcDay(): number {
  const now = new Date();
  const tomorrow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((tomorrow - now.getTime()) / 1_000));
}

function errorResponse(error: PublicApiError, serverRequestId: string): Response {
  const body: AiApiErrorResponseDto = {
    error: {
      code: error.code,
      message: error.message,
      serverRequestId,
      ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
    },
  };
  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  if (error.retryAfterSeconds !== undefined) headers['retry-after'] = String(error.retryAfterSeconds);
  return json(body, error.statusCode, headers);
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function routeLabel(pathname: string): string {
  return ['/health', '/api/v1/config', '/api/v1/sessions', '/api/v1/answers'].includes(pathname)
    ? pathname
    : 'unmatched';
}
