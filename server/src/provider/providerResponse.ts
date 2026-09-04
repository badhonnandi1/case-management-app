import type { AiResolvedCitationDto } from '../../../shared/aiAnswerContract.js';
import type { ProviderAnswerPayload, ValidatedAnswerRequest } from '../contracts.js';
import { providerAnswerSchema } from '../contracts.js';
import { PublicApiError } from '../errors.js';

export function parseAndResolveProviderAnswer(
  rawText: string,
  request: ValidatedAnswerRequest,
): Omit<ProviderAnswerPayload, 'citations'> & { citations: AiResolvedCitationDto[] } {
  let rawValue: unknown;
  try {
    rawValue = JSON.parse(stripCodeFence(rawText));
  } catch {
    throw invalidProviderResponse('The online AI returned unreadable structured data.');
  }
  const parsed = providerAnswerSchema.safeParse(rawValue);
  if (!parsed.success) throw invalidProviderResponse('The online AI returned an unsupported response structure.');

  const evidenceById = new Map(request.evidence.map((item) => [item.evidenceId, item]));
  const seen = new Set<string>();
  const citations: AiResolvedCitationDto[] = [];
  for (const citation of parsed.data.citations) {
    if (seen.has(citation.evidenceId)) continue;
    const evidence = evidenceById.get(citation.evidenceId);
    if (!evidence) throw invalidProviderResponse('The online AI returned an unknown citation.');
    seen.add(citation.evidenceId);
    citations.push({
      evidenceId: evidence.evidenceId,
      chunkId: evidence.chunkId,
      caseId: evidence.caseId,
      documentId: evidence.documentId,
      documentName: evidence.documentName,
      pageStart: evidence.pageStart,
      pageEnd: evidence.pageEnd,
      citationNumber: citations.length + 1,
      supportingStatement: citation.supportingStatement ?? null,
    });
  }
  if (citations.length === 0 && !parsed.data.insufficientEvidence) {
    throw invalidProviderResponse('The online AI answer did not include a resolvable citation.');
  }
  return {
    answer: parsed.data.answer,
    citations,
    insufficientEvidence: parsed.data.insufficientEvidence,
    warnings: parsed.data.warnings,
  };
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1] ?? trimmed;
}

function invalidProviderResponse(message: string): PublicApiError {
  return new PublicApiError('INVALID_PROVIDER_RESPONSE', 502, message);
}
