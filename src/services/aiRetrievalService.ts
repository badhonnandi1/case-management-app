import type { AiSearchResult } from '../models/AiChunk';
import { searchAiChunks } from '../repositories/aiChunkRepository';
import { estimateTokenCount } from '../utils/chunkText';
import { buildSafeFtsQuery } from '../utils/ftsQuery';

export { buildSafeFtsQuery } from '../utils/ftsQuery';

export interface AiRetrievalScope {
  caseIds: readonly string[];
  documentIds: readonly string[];
}

export async function retrieveLocalContext(
  query: string,
  scope: AiRetrievalScope,
  resultLimit = 8,
): Promise<AiSearchResult[]> {
  const caseIds = uniqueIds(scope.caseIds);
  const documentIds = uniqueIds(scope.documentIds);
  if (caseIds.length === 0 || documentIds.length === 0) {
    throw new Error('Select at least one case and one document before searching.');
  }
  const ftsQuery = buildSafeFtsQuery(query);
  if (!ftsQuery) return [];
  const candidates = await searchAiChunks({ ftsQuery, caseIds, documentIds, limit: 20 });
  const selected: AiSearchResult[] = [];
  const maximum = Math.max(5, Math.min(8, Math.trunc(resultLimit)));
  for (const candidate of candidates) {
    if (!isUseful(candidate.content)) continue;
    if (selected.some((existing) => isNearDuplicate(existing.content, candidate.content))) continue;
    selected.push(candidate);
    if (selected.length >= maximum) break;
  }
  return selected;
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

function isUseful(content: string): boolean {
  return content.trim().length >= 30 && estimateTokenCount(content) >= 8;
}

function isNearDuplicate(left: string, right: string): boolean {
  const leftWords = wordSet(left);
  const rightWords = wordSet(right);
  if (leftWords.size === 0 || rightWords.size === 0) return true;
  let intersection = 0;
  for (const word of leftWords) if (rightWords.has(word)) intersection += 1;
  const union = leftWords.size + rightWords.size - intersection;
  return intersection / union >= 0.9;
}

function wordSet(text: string): Set<string> {
  return new Set(text.normalize('NFC').toLocaleLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []);
}
