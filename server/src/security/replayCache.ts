import { createHash } from 'node:crypto';

import type { AiAnswerResponseDto } from '../../../shared/aiAnswerContract.js';
import { PublicApiError } from '../errors.js';

interface Entry {
  fingerprint: string;
  expiresAt: number;
  response: Promise<AiAnswerResponseDto>;
}

export interface AnswerReplayCache {
  run(
    sessionId: string,
    requestId: string,
    canonicalPayload: string,
    operation: () => Promise<AiAnswerResponseDto>,
  ): Promise<AiAnswerResponseDto>;
}

export function createAnswerReplayCache(now: () => number = Date.now): AnswerReplayCache {
  const entries = new Map<string, Entry>();
  return {
    async run(sessionId, requestId, canonicalPayload, operation) {
      const key = `${sessionId}:${requestId}`;
      const fingerprint = createHash('sha256').update(canonicalPayload).digest('base64url');
      const existing = entries.get(key);
      if (existing && existing.expiresAt > now()) {
        if (existing.fingerprint !== fingerprint) {
          throw new PublicApiError('INVALID_REQUEST', 409, 'This request ID was already used for different content.');
        }
        return existing.response;
      }
      const response = operation();
      entries.set(key, { fingerprint, expiresAt: now() + 5 * 60_000, response });
      try {
        return await response;
      } catch (error) {
        entries.delete(key);
        throw error;
      } finally {
        if (entries.size > 5_000) {
          const timestamp = now();
          for (const [entryKey, entry] of entries) if (entry.expiresAt <= timestamp) entries.delete(entryKey);
        }
      }
    },
  };
}
