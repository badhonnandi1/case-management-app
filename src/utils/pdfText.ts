import type { TextPage } from './chunkText';

export type SelectableTextClassification = 'success' | 'requires_ocr' | 'empty';

export function classifySelectableText(
  pages: readonly TextPage[],
  pageCount: number,
): SelectableTextClassification {
  if (pageCount === 0) return 'empty';
  const lowTextPages = pages.filter((page) => visibleCharacterCount(page.text) < 20).length;
  return lowTextPages === pageCount || lowTextPages / pageCount >= 0.6
    ? 'requires_ocr'
    : 'success';
}

function visibleCharacterCount(text: string): number {
  return [...text].filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
}
