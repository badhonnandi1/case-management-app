export function buildSafeFtsQuery(query: string): string {
  const tokens = query.normalize('NFC').match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  const unique = [...new Set(tokens.map((token) => token.toLocaleLowerCase()).filter(Boolean))].slice(0, 16);
  return unique.map((token) => `"${token}"*`).join(' OR ');
}
