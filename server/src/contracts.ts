import { z } from 'zod';

import {
  AI_API_LIMITS,
} from '../../shared/aiAnswerContract.js';

const opaqueId = z.string().trim().min(1).max(128).regex(/^[\p{L}\p{N}._:-]+$/u);

export const evidenceSchema = z.object({
  evidenceId: opaqueId,
  chunkId: opaqueId,
  caseId: opaqueId,
  documentId: opaqueId,
  documentName: z.string().trim().min(1).max(240),
  pageStart: z.number().int().positive(),
  pageEnd: z.number().int().positive(),
  excerpt: z.string().trim().min(1).max(AI_API_LIMITS.evidenceCharacters),
  localRank: z.number().finite(),
}).strict().refine((value) => value.pageEnd >= value.pageStart, {
  message: 'pageEnd must be greater than or equal to pageStart.',
  path: ['pageEnd'],
});

export const answerRequestSchema = z.object({
  requestId: opaqueId,
  threadId: opaqueId,
  question: z.string().trim().min(1).max(AI_API_LIMITS.questionCharacters),
  selectedCaseIds: z.array(opaqueId).min(1).max(AI_API_LIMITS.selectedCases),
  selectedDocumentIds: z.array(opaqueId).min(1).max(AI_API_LIMITS.selectedDocuments),
  evidence: z.array(evidenceSchema).min(1).max(AI_API_LIMITS.evidenceItems),
  language: z.enum(['auto', 'bn', 'en', 'mixed']),
  modelId: opaqueId.regex(/^gemini-[a-z0-9.-]+$/).optional(),
  consent: z.object({
    granted: z.literal(true),
    version: z.string().trim().min(8).max(128),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (new Set(value.selectedCaseIds).size !== value.selectedCaseIds.length) {
    context.addIssue({ code: 'custom', message: 'Selected case IDs must be unique.', path: ['selectedCaseIds'] });
  }
  if (new Set(value.selectedDocumentIds).size !== value.selectedDocumentIds.length) {
    context.addIssue({ code: 'custom', message: 'Selected document IDs must be unique.', path: ['selectedDocumentIds'] });
  }
  const evidenceIds = new Set<string>();
  let totalCharacters = 0;
  for (const [index, evidence] of value.evidence.entries()) {
    totalCharacters += evidence.excerpt.length;
    if (evidenceIds.has(evidence.evidenceId)) {
      context.addIssue({ code: 'custom', message: 'Evidence IDs must be unique.', path: ['evidence', index, 'evidenceId'] });
    }
    evidenceIds.add(evidence.evidenceId);
    if (!value.selectedCaseIds.includes(evidence.caseId)) {
      context.addIssue({ code: 'custom', message: 'Evidence case is outside the selected scope.', path: ['evidence', index, 'caseId'] });
    }
    if (!value.selectedDocumentIds.includes(evidence.documentId)) {
      context.addIssue({ code: 'custom', message: 'Evidence document is outside the selected scope.', path: ['evidence', index, 'documentId'] });
    }
  }
  if (totalCharacters > AI_API_LIMITS.totalEvidenceCharacters) {
    context.addIssue({ code: 'custom', message: 'Total evidence is too large.', path: ['evidence'] });
  }
});

export const providerAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(AI_API_LIMITS.answerCharacters),
  citations: z.array(z.object({
    evidenceId: opaqueId,
    supportingStatement: z.string().trim().min(1).max(500).nullable().optional(),
  }).strict()).max(AI_API_LIMITS.evidenceItems),
  insufficientEvidence: z.boolean(),
  warnings: z.array(z.string().trim().min(1).max(500)).max(AI_API_LIMITS.warnings),
}).strict();

export const PROVIDER_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'citations', 'insufficientEvidence', 'warnings'],
  properties: {
    answer: { type: 'string', description: 'Answer grounded only in supplied evidence.' },
    citations: {
      type: 'array',
      maxItems: AI_API_LIMITS.evidenceItems,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['evidenceId', 'supportingStatement'],
        properties: {
          evidenceId: { type: 'string', description: 'An exact supplied opaque evidence ID.' },
          supportingStatement: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
    },
    insufficientEvidence: { type: 'boolean' },
    warnings: { type: 'array', maxItems: AI_API_LIMITS.warnings, items: { type: 'string' } },
  },
} as const;

export type ValidatedAnswerRequest = z.infer<typeof answerRequestSchema>;
export type ProviderAnswerPayload = z.infer<typeof providerAnswerSchema>;
