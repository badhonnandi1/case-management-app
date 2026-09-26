interface SessionTokenPayload {
  sid: string;
  tid: string;
  exp: number;
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function signSessionToken(payload: SessionTokenPayload, encodedSecret: string): Promise<string> {
  const encodedPayload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmac(encodedPayload, encodedSecret);
  return `${encodedPayload}.${bytesToBase64Url(signature)}`;
}

export async function verifySessionToken(token: string, encodedSecret: string): Promise<SessionTokenPayload | null> {
  const separator = token.indexOf('.');
  if (separator <= 0 || separator === token.length - 1) return null;
  const encodedPayload = token.slice(0, separator);
  const suppliedSignature = token.slice(separator + 1);
  let expectedSignature: Uint8Array;
  let supplied: Uint8Array;
  let payload: unknown;
  try {
    expectedSignature = await hmac(encodedPayload, encodedSecret);
    supplied = base64UrlToBytes(suppliedSignature);
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encodedPayload)));
  } catch {
    return null;
  }
  if (!constantTimeEqual(expectedSignature, supplied) || !isSessionTokenPayload(payload)) return null;
  return payload;
}

export function validateSigningSecret(encodedSecret: string): boolean {
  try {
    return base64UrlToBytes(encodedSecret).length >= 32;
  } catch {
    return false;
  }
}

async function hmac(value: string, encodedSecret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    base64UrlToBytes(encodedSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return new Uint8Array(signature);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('Invalid base64url value.');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length === 0 || right.length === 0) return false;
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index % left.length] ?? 0) ^ (right[index % right.length] ?? 0);
  }
  return difference === 0;
}

function isSessionTokenPayload(value: unknown): value is SessionTokenPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.sid === 'string' && record.sid.length >= 16
    && typeof record.tid === 'string' && record.tid.length >= 16
    && typeof record.exp === 'number' && Number.isInteger(record.exp);
}
