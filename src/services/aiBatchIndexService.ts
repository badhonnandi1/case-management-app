import type { AiDocumentChoice, AiPreparationItem } from '../models/AiUi';
import { indexDocument } from './aiIndexService';

const activeDocumentIds = new Set<string>();

export interface AiBatchIndexOptions {
  signal?: AbortSignal;
  onChange?: (items: readonly AiPreparationItem[], activeIndex: number) => void;
}

export async function prepareAiDocumentsSequentially(
  choicesInput: readonly AiDocumentChoice[],
  options: AiBatchIndexOptions = {},
): Promise<AiPreparationItem[]> {
  const seen = new Set<string>();
  const choices = choicesInput.filter((choice) => {
    if (seen.has(choice.document.id)) return false;
    seen.add(choice.document.id);
    return true;
  });
  const items: AiPreparationItem[] = choices.map((choice) => ({
    documentId: choice.document.id,
    documentName: choice.document.fileName,
    status: 'queued',
    stage: null,
    completedPages: 0,
    pageCount: null,
    message: null,
  }));
  options.onChange?.(items, -1);

  for (let index = 0; index < choices.length; index += 1) {
    const choice = choices[index];
    if (!choice) continue;
    if (options.signal?.aborted) {
      markRemainingCancelled(items, index);
      options.onChange?.([...items], index);
      break;
    }
    const current = items[index];
    if (!current) continue;
    if (activeDocumentIds.has(choice.document.id)) {
      items[index] = { ...current, status: 'failed', message: 'This document is already being prepared.' };
      options.onChange?.([...items], index);
      continue;
    }

    activeDocumentIds.add(choice.document.id);
    items[index] = { ...current, status: 'preparing', stage: 'validating' };
    options.onChange?.([...items], index);
    try {
      const result = await indexDocument(choice.document.id, {
        signal: options.signal,
        onProgress: (progress) => {
          const previous = items[index];
          if (!previous) return;
          items[index] = {
            ...previous,
            status: 'preparing',
            stage: progress.stage,
            completedPages: progress.completedPages ?? previous.completedPages,
            pageCount: progress.pageCount ?? previous.pageCount,
          };
          options.onChange?.([...items], index);
        },
      });
      const previous = items[index];
      if (!previous) continue;
      if (result.status === 'ready') {
        items[index] = { ...previous, status: 'ready', stage: 'complete', pageCount: result.pageCount };
      } else if (result.status === 'skipped') {
        items[index] = { ...previous, status: 'reused', stage: 'skipped' };
      } else {
        items[index] = { ...previous, status: result.status, stage: null, message: result.message };
      }
    } catch {
      const previous = items[index];
      if (previous) items[index] = { ...previous, status: 'failed', stage: null, message: 'Preparation failed. Please retry.' };
    } finally {
      activeDocumentIds.delete(choice.document.id);
      options.onChange?.([...items], index);
    }
  }
  return items;
}

export function isDocumentPreparationActive(documentId: string): boolean {
  return activeDocumentIds.has(documentId);
}

function markRemainingCancelled(items: AiPreparationItem[], startIndex: number): void {
  for (let index = startIndex; index < items.length; index += 1) {
    const item = items[index];
    if (item?.status === 'queued') {
      items[index] = { ...item, status: 'cancelled', message: 'Preparation was cancelled.' };
    }
  }
}
