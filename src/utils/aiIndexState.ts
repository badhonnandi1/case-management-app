import type { AiSource, AiSourceState } from '../models/AiSource';

export function classifyAiSource(
  source: AiSource | null,
  fileHash: string,
  parserVersion: string,
): AiSourceState {
  if (!source) return 'absent';
  if (source.extractionStatus === 'indexing') return 'interrupted';
  if (source.extractionStatus === 'failed' || source.extractionStatus === 'missing') return 'failed';
  if (
    source.extractionStatus === 'ready'
    && source.fileHash === fileHash
    && source.parserVersion === parserVersion
  ) return 'ready';
  return 'outdated';
}
