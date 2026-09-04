import type { NewAiChunk } from '../models/AiChunk';

export interface TextPage {
  pageNumber: number;
  text: string;
}

export interface ChunkingOptions {
  targetTokens?: number;
  minimumTokens?: number;
  maximumTokens?: number;
  overlapTokens?: number;
}

interface TextUnit extends TextPage { tokens: number }

const DEFAULT_TARGET = 650;
const DEFAULT_MINIMUM = 500;
const DEFAULT_MAXIMUM = 800;
const DEFAULT_OVERLAP = 100;

export function normalizePageText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeExtractedPages(pages: readonly TextPage[]): TextPage[] {
  const normalized = pages.map((page) => ({
    pageNumber: page.pageNumber,
    text: normalizePageText(page.text),
  }));
  const repeatedBoundaryLines = findReliableRepeatedBoundaryLines(normalized);
  if (repeatedBoundaryLines.size === 0) return normalized;
  return normalized.map((page) => ({
    ...page,
    text: page.text
      .split('\n')
      .filter((line) => !repeatedBoundaryLines.has(line.trim()))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  }));
}

/**
 * Deterministic approximation used until the backend model tokenizer is known.
 * Latin/digit runs are estimated at one token per four code points, Bangla runs
 * at one token per two code points, and standalone punctuation as one token.
 */
export function estimateTokenCount(text: string): number {
  const pieces = text.match(/[\p{L}\p{M}\p{N}]+|[^\s\p{L}\p{M}\p{N}]/gu) ?? [];
  return pieces.reduce((total, piece) => {
    const length = [...piece].length;
    if (/^[\u0980-\u09FF]/u.test(piece)) return total + Math.max(1, Math.ceil(length / 2));
    if (/^[\p{L}\p{M}\p{N}]+$/u.test(piece)) return total + Math.max(1, Math.ceil(length / 4));
    return total + 1;
  }, 0);
}

export function chunkPages(
  pages: readonly TextPage[],
  options: ChunkingOptions = {},
): NewAiChunk[] {
  const target = options.targetTokens ?? DEFAULT_TARGET;
  const minimum = options.minimumTokens ?? DEFAULT_MINIMUM;
  const maximum = options.maximumTokens ?? DEFAULT_MAXIMUM;
  const overlap = options.overlapTokens ?? DEFAULT_OVERLAP;
  if (!(minimum > 0 && target >= minimum && maximum >= target && overlap >= 0 && overlap < minimum)) {
    throw new Error('Invalid chunking token limits.');
  }
  const normalized = normalizeExtractedPages(pages);
  const units = normalized.flatMap((page) => splitPageIntoUnits(page, maximum));
  const output: NewAiChunk[] = [];
  const seen = new Set<string>();
  let current: TextUnit[] = [];
  let currentTokens = 0;

  const commit = () => {
    if (current.length === 0) return;
    const content = current.map((unit) => unit.text).join('\n\n').trim();
    if (content && !seen.has(content)) {
      seen.add(content);
      output.push({
        chunkIndex: output.length,
        pageStart: Math.min(...current.map((unit) => unit.pageNumber)),
        pageEnd: Math.max(...current.map((unit) => unit.pageNumber)),
        content,
      });
    }
  };

  for (const unit of units) {
    const wouldExceed = currentTokens + unit.tokens > maximum;
    if (current.length > 0 && wouldExceed) {
      commit();
      current = takeOverlap(current, Math.min(overlap, Math.max(0, maximum - unit.tokens)));
      currentTokens = sumTokens(current);
    }
    current.push(unit);
    currentTokens += unit.tokens;
    if (currentTokens >= target && currentTokens >= minimum) {
      commit();
      current = takeOverlap(current, overlap);
      currentTokens = sumTokens(current);
    }
  }
  if (current.length > 0) {
    const content = current.map((unit) => unit.text).join('\n\n').trim();
    if (!seen.has(content)) commit();
  }
  return output;
}

function splitPageIntoUnits(page: TextPage, maximum: number): TextUnit[] {
  if (!page.text) return [];
  const paragraphs = page.text.split(/\n{2,}/).map((value) => value.trim()).filter(Boolean);
  return paragraphs.flatMap((paragraph) => splitLongText(paragraph, page.pageNumber, maximum));
}

function splitLongText(text: string, pageNumber: number, maximum: number): TextUnit[] {
  const tokenCount = estimateTokenCount(text);
  if (tokenCount <= maximum) return [{ pageNumber, text, tokens: tokenCount }];
  const sentences = text.match(/[^.!?।\n]+[.!?।]?/gu)?.map((value) => value.trim()).filter(Boolean) ?? [text];
  const units: TextUnit[] = [];
  let buffer: string[] = [];
  let bufferTokens = 0;
  for (const sentence of sentences) {
    const sentenceTokens = estimateTokenCount(sentence);
    if (sentenceTokens > maximum) {
      if (buffer.length) units.push(makeUnit(buffer.join(' '), pageNumber));
      buffer = [];
      bufferTokens = 0;
      units.push(...splitByWords(sentence, pageNumber, maximum));
    } else if (bufferTokens + sentenceTokens > maximum && buffer.length) {
      units.push(makeUnit(buffer.join(' '), pageNumber));
      buffer = [sentence];
      bufferTokens = sentenceTokens;
    } else {
      buffer.push(sentence);
      bufferTokens += sentenceTokens;
    }
  }
  if (buffer.length) units.push(makeUnit(buffer.join(' '), pageNumber));
  return units;
}

function splitByWords(text: string, pageNumber: number, maximum: number): TextUnit[] {
  const words = text.split(/\s+/).filter(Boolean);
  const units: TextUnit[] = [];
  let buffer: string[] = [];
  for (const word of words) {
    const candidate = [...buffer, word].join(' ');
    if (buffer.length && estimateTokenCount(candidate) > maximum) {
      units.push(makeUnit(buffer.join(' '), pageNumber));
      buffer = [word];
    } else {
      buffer.push(word);
    }
  }
  if (buffer.length) units.push(makeUnit(buffer.join(' '), pageNumber));
  return units;
}

function makeUnit(text: string, pageNumber: number): TextUnit {
  return { pageNumber, text, tokens: estimateTokenCount(text) };
}

function takeOverlap(units: readonly TextUnit[], limit: number): TextUnit[] {
  if (limit <= 0) return [];
  const selected: TextUnit[] = [];
  let tokens = 0;
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index];
    if (!unit) continue;
    if (selected.length > 0 && tokens + unit.tokens > limit) break;
    if (unit.tokens > limit && selected.length === 0) {
      const suffix = takeTextSuffix(unit, limit);
      if (suffix) selected.unshift(suffix);
      break;
    }
    selected.unshift(unit);
    tokens += unit.tokens;
  }
  return selected;
}

function takeTextSuffix(unit: TextUnit, limit: number): TextUnit | null {
  const words = unit.text.split(/\s+/).filter(Boolean);
  const suffix: string[] = [];
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = words[index];
    if (!word) continue;
    const candidate = [word, ...suffix].join(' ');
    if (suffix.length > 0 && estimateTokenCount(candidate) > limit) break;
    if (estimateTokenCount(candidate) > limit) return null;
    suffix.unshift(word);
  }
  if (suffix.length === 0) return null;
  return makeUnit(suffix.join(' '), unit.pageNumber);
}

function sumTokens(units: readonly TextUnit[]): number {
  return units.reduce((total, unit) => total + unit.tokens, 0);
}

function findReliableRepeatedBoundaryLines(pages: readonly TextPage[]): Set<string> {
  if (pages.length < 3) return new Set();
  const counts = new Map<string, number>();
  for (const page of pages) {
    const lines = page.text.split('\n').map((line) => line.trim()).filter(Boolean);
    const candidates = new Set([lines[0], lines.at(-1)].filter((line): line is string => Boolean(line)));
    for (const line of candidates) {
      if (line.length >= 4 && line.length <= 160) counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.8));
  return new Set([...counts].filter(([, count]) => count >= threshold).map(([line]) => line));
}
