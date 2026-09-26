import { randomUUID } from 'node:crypto';

import cors from '@fastify/cors';
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
} from 'fastify';

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
} from '../../shared/aiAnswerContract.js';
import { decodeSigningSecret, type ServerConfig } from './config.js';
import { answerRequestSchema } from './contracts.js';
import { PublicApiError } from './errors.js';
import { jsonOperationalLogger, type OperationalLogger } from './logger.js';
import type { AiAnswerProvider } from './provider/provider.js';
import { createMinuteRateLimiter, type RateLimiter } from './security/rateLimiter.js';
import { createAnswerReplayCache, type AnswerReplayCache } from './security/replayCache.js';
import { createAnonymousSessionTokens, type AnonymousSessionTokens } from './security/sessionTokens.js';

interface BuildAppDependencies {
  config: ServerConfig;
  provider: AiAnswerProvider;
  logger?: OperationalLogger;
  rateLimiter?: RateLimiter;
  sessionTokens?: AnonymousSessionTokens;
  replayCache?: AnswerReplayCache;
}

interface RequestMetrics {
  startedAt: number;
  payloadBytes: number | null;
  evidenceCount: number | null;
  providerLatencyMs: number | null;
  errorCategory: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

const metricsByRequest = new WeakMap<FastifyRequest, RequestMetrics>();

export async function buildServerApp(dependencies: BuildAppDependencies): Promise<FastifyInstance> {
  const { config, provider } = dependencies;
  const operationalLogger = dependencies.logger ?? jsonOperationalLogger;
  const rateLimiter = dependencies.rateLimiter ?? createMinuteRateLimiter();
  const sessionTokens = dependencies.sessionTokens ?? createAnonymousSessionTokens(
    config.sessionTtlSeconds,
    config.sessionSigningSecret ? decodeSigningSecret(config.sessionSigningSecret) : undefined,
  );
  const replayCache = dependencies.replayCache ?? createAnswerReplayCache();
  const app = Fastify({
    logger: false,
    bodyLimit: AI_API_LIMITS.requestBytes,
    trustProxy: config.trustProxy,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
  });

  await app.register(cors, {
    credentials: false,
    methods: ['GET', 'POST'],
    allowedHeaders: ['authorization', 'content-type'],
    origin(origin, callback) {
      if (origin === undefined || config.allowedOrigins.includes(origin)) callback(null, true);
      else callback(new PublicApiError('UNAUTHORIZED', 403, 'Origin is not allowed.'), false);
    },
  });

  // Fastify hooks must either be async or invoke a callback; this one uses the async form.
  // eslint-disable-next-line @typescript-eslint/require-await
  app.addHook('onRequest', async (request) => {
    metricsByRequest.set(request, emptyMetrics());
    if (config.production && request.protocol !== 'https' && request.routeOptions.url !== '/health') {
      throw new PublicApiError('INVALID_REQUEST', 400, 'HTTPS is required.');
    }
  });

  app.addHook('onResponse', (request, reply) => {
    const metrics = metricsByRequest.get(request) ?? emptyMetrics();
    operationalLogger.write({
      serverRequestId: request.id,
      timestamp: new Date().toISOString(),
      endpoint: routeLabel(request),
      statusCode: reply.statusCode,
      durationMs: Math.max(0, Math.round(performance.now() - metrics.startedAt)),
      payloadBytes: metrics.payloadBytes,
      evidenceCount: metrics.evidenceCount,
      providerLatencyMs: metrics.providerLatencyMs,
      errorCategory: metrics.errorCategory,
      inputTokens: metrics.inputTokens,
      outputTokens: metrics.outputTokens,
    });
  });

  app.get('/health', (): AiHealthResponseDto => ({
    status: onlineAnswersAvailable(config, provider) ? 'ok' : 'degraded',
    apiVersion: AI_API_VERSION,
    onlineAnswers: onlineAnswersAvailable(config, provider) ? 'available' : 'provider_not_configured',
  }));

  app.get('/api/v1/config', (request, reply): AiPublicConfigDto => {
    enforceRateLimit(rateLimiter, `config-ip:${request.ip}`, config.sessionIssueLimitPerMinute);
    void reply.header('cache-control', 'public, max-age=60');
    return publicConfiguration(config, onlineAnswersAvailable(config, provider));
  });

  app.post('/api/v1/sessions', (request, reply): AiSessionResponseDto => {
    enforceRateLimit(rateLimiter, `session-ip:${request.ip}`, config.sessionIssueLimitPerMinute);
    const { token, session } = sessionTokens.issue();
    void reply.header('cache-control', 'no-store');
    return { sessionToken: token, expiresAt: session.expiresAt.toISOString() };
  });

  app.post('/api/v1/answers', async (request, reply): Promise<AiAnswerResponseDto> => {
    const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'application/json') {
      throw new PublicApiError('INVALID_REQUEST', 415, 'Content-Type must be application/json.');
    }
    const session = authorize(request, sessionTokens);
    enforceRateLimit(rateLimiter, `answer-ip:${request.ip}`, config.ipRateLimitPerMinute);
    enforceRateLimit(rateLimiter, `answer-session:${session.sessionId}`, config.answerRateLimitPerMinute);
    const metrics = metricsByRequest.get(request) ?? emptyMetrics();
    const payloadText = JSON.stringify(request.body ?? null);
    metrics.payloadBytes = Buffer.byteLength(payloadText);
    if (metrics.payloadBytes > AI_API_LIMITS.requestBytes) {
      throw new PublicApiError('PAYLOAD_TOO_LARGE', 413, 'The request is too large.');
    }
    const validated = answerRequestSchema.safeParse(request.body);
    if (!validated.success) throw classifyValidationError(request.body);
    metrics.evidenceCount = validated.data.evidence.length;
    if (validated.data.consent.version !== config.consentPolicyVersion) {
      throw new PublicApiError('CONSENT_REQUIRED', 400, 'Consent must be renewed for the current online data policy.');
    }
    const requestedModel = validated.data.modelId ?? 'balanced';
    const selectedModel = requestedModel === 'balanced'
      ? config.geminiDefaultModel
      : requestedModel;
    if (requestedModel !== 'balanced' && !config.geminiAllowedModels.includes(requestedModel)) {
      throw new PublicApiError('MODEL_NOT_ALLOWED', 400, 'The selected model is not available. Refresh AI configuration and try again.');
    }
    if (!onlineAnswersAvailable(config, provider)) {
      throw new PublicApiError('PROVIDER_NOT_CONFIGURED', 503, 'Online answers are not configured on this server.');
    }

    const answer = await replayCache.run(
      session.sessionId,
      validated.data.requestId,
      payloadText,
      async () => {
        const controller = new AbortController();
        let timedOut = false;
        let disconnected = false;
        const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, config.providerTimeoutMs);
        const abortOnDisconnect = () => { disconnected = true; controller.abort(); };
        request.raw.once('aborted', abortOnDisconnect);
        reply.raw.once('close', abortOnDisconnect);
        const providerStartedAt = performance.now();
        try {
          const result = await provider.answer(validated.data, controller.signal, selectedModel);
          metrics.providerLatencyMs = Math.max(0, Math.round(performance.now() - providerStartedAt));
          metrics.inputTokens = result.usage.inputTokens;
          metrics.outputTokens = result.usage.outputTokens;
          return {
            requestId: validated.data.requestId,
            serverRequestId: request.id,
            ...result,
            usage: { ...result.usage, modelName: 'Balanced' },
          };
        } catch (error) {
          if (timedOut) throw new PublicApiError('PROVIDER_TIMEOUT', 504, 'The online AI service took too long to respond.');
          if (disconnected) throw new PublicApiError('REQUEST_CANCELLED', 499, 'The request was cancelled.');
          throw error;
        } finally {
          clearTimeout(timeout);
          request.raw.off('aborted', abortOnDisconnect);
          reply.raw.off('close', abortOnDisconnect);
        }
      },
    );
    void reply.header('cache-control', 'no-store');
    return { ...answer, serverRequestId: request.id };
  });

  app.setErrorHandler(async (error, request, reply) => {
    const publicError = toPublicError(error);
    const metrics = metricsByRequest.get(request);
    if (metrics) metrics.errorCategory = publicError.code;
    if (publicError.retryAfterSeconds !== undefined) {
      void reply.header('retry-after', String(publicError.retryAfterSeconds));
    }
    void reply.header('cache-control', 'no-store');
    const body: AiApiErrorResponseDto = {
      error: {
        code: publicError.code,
        message: publicError.message,
        serverRequestId: request.id,
        ...(publicError.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: publicError.retryAfterSeconds }),
      },
    };
    await reply.status(publicError.statusCode).send(body);
  });

  return app;
}

function onlineAnswersAvailable(config: ServerConfig, provider: AiAnswerProvider): boolean {
  return config.onlineAnswersEnabled && provider.configured;
}

function publicConfiguration(config: ServerConfig, onlineAnswers: boolean): AiPublicConfigDto {
  return {
    apiVersion: AI_API_VERSION,
    serverContractVersion: AI_SERVER_CONTRACT_VERSION,
    providerDisplayName: AI_PROVIDER_DISPLAY_NAME,
    defaultModelId: 'balanced',
    allowedModels: [{ id: 'balanced', displayName: 'Balanced' }],
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
    },
    features: {
      onlineAnswers,
      modelSelection: false,
    },
  };
}

function authorize(request: FastifyRequest, tokens: AnonymousSessionTokens) {
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  const session = token ? tokens.verify(token) : null;
  if (!session) throw new PublicApiError('UNAUTHORIZED', 401, 'A valid anonymous session is required.');
  return session;
}

function enforceRateLimit(rateLimiter: RateLimiter, key: string, maximum: number): void {
  const result = rateLimiter.consume(key, maximum);
  if (!result.allowed) {
    throw new PublicApiError('RATE_LIMITED', 429, 'Too many requests. Please try again later.', result.retryAfterSeconds);
  }
}

function classifyValidationError(body: unknown): PublicApiError {
  if (typeof body === 'object' && body !== null) {
    const record = body as Record<string, unknown>;
    if (!record.consent || typeof record.consent !== 'object' || (record.consent as Record<string, unknown>).granted !== true) {
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
  if (error instanceof PublicApiError) return error;
  const code = typeof error === 'object' && error !== null
    ? (error as { code?: string }).code
    : undefined;
  if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    return new PublicApiError('PAYLOAD_TOO_LARGE', 413, 'The request is too large.');
  }
  if (code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
    return new PublicApiError('INVALID_REQUEST', 415, 'Content-Type must be application/json.');
  }
  return new PublicApiError('INTERNAL_ERROR', 500, 'The server could not complete the request.');
}

function emptyMetrics(): RequestMetrics {
  return {
    startedAt: performance.now(),
    payloadBytes: null,
    evidenceCount: null,
    providerLatencyMs: null,
    errorCategory: null,
    inputTokens: null,
    outputTokens: null,
  };
}

function routeLabel(request: FastifyRequest): string {
  const route = request.routeOptions.url;
  return typeof route === 'string' ? route : 'unmatched';
}
