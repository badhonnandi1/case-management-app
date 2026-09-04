export type AiBackendConfigResult =
  | { configured: true; baseUrl: string }
  | { configured: false; reason: 'not_configured' | 'invalid_url' | 'insecure_url' };

export function validateAiBackendUrl(value: string | undefined, production: boolean): AiBackendConfigResult {
  const input = value?.trim();
  if (!input) return { configured: false, reason: 'not_configured' };
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      return { configured: false, reason: 'invalid_url' };
    }
    if (production && url.protocol !== 'https:') return { configured: false, reason: 'insecure_url' };
    const baseUrl = url.toString().replace(/\/$/, '');
    return { configured: true, baseUrl };
  } catch {
    return { configured: false, reason: 'invalid_url' };
  }
}
