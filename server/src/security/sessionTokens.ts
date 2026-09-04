import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface AnonymousSession {
  sessionId: string;
  expiresAt: Date;
}

export interface AnonymousSessionTokens {
  issue(): { token: string; session: AnonymousSession };
  verify(token: string): AnonymousSession | null;
}

interface TokenPayload {
  sid: string;
  exp: number;
}

export function createAnonymousSessionTokens(
  ttlSeconds: number,
  secret = randomBytes(32),
  now: () => number = Date.now,
): AnonymousSessionTokens {
  return {
    issue() {
      const payload: TokenPayload = {
        sid: randomBytes(18).toString('base64url'),
        exp: Math.floor(now() / 1_000) + ttlSeconds,
      };
      return {
        token: sign(payload, secret),
        session: { sessionId: payload.sid, expiresAt: new Date(payload.exp * 1_000) },
      };
    },
    verify(token) {
      const separator = token.indexOf('.');
      if (separator <= 0 || separator === token.length - 1) return null;
      const encoded = token.slice(0, separator);
      const signature = token.slice(separator + 1);
      const expected = createHmac('sha256', secret).update(encoded).digest();
      let supplied: Buffer;
      try {
        supplied = Buffer.from(signature, 'base64url');
      } catch {
        return null;
      }
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
      try {
        const value: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        if (!isTokenPayload(value) || value.exp <= Math.floor(now() / 1_000)) return null;
        return { sessionId: value.sid, expiresAt: new Date(value.exp * 1_000) };
      } catch {
        return null;
      }
    },
  };
}

function sign(payload: TokenPayload, secret: Buffer): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function isTokenPayload(value: unknown): value is TokenPayload {
  return typeof value === 'object'
    && value !== null
    && typeof (value as TokenPayload).sid === 'string'
    && (value as TokenPayload).sid.length >= 16
    && Number.isInteger((value as TokenPayload).exp);
}
