import { buildServerApp } from './app.js';
import { loadServerConfig } from './config.js';
import { GeminiAnswerProvider } from './provider/geminiProvider.js';
import {
  AI_CONSENT_VERSION,
  isAiApiErrorResponseDto,
  isAiHealthResponseDto,
  isAiSessionResponseDto,
} from '../../shared/aiAnswerContract.js';

const config = loadServerConfig({ NODE_ENV: 'test' });
const provider = new GeminiAnswerProvider(null);
const app = await buildServerApp({ config, provider, logger: { write() {} } });

try {
  const health = await app.inject({ method: 'GET', url: '/health' });
  const healthBody: unknown = health.json();
  if (health.statusCode !== 200 || !isAiHealthResponseDto(healthBody)
    || healthBody.onlineAnswers !== 'provider_not_configured') {
    throw new Error('Safe health check failed.');
  }
  const sessionResponse = await app.inject({ method: 'POST', url: '/api/v1/sessions' });
  const sessionBody: unknown = sessionResponse.json();
  if (!isAiSessionResponseDto(sessionBody)) throw new Error('Safe session check failed.');
  const token = sessionBody.sessionToken;
  const answer = await app.inject({
    method: 'POST',
    url: '/api/v1/answers',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    payload: {
      requestId: 'synthetic-request',
      threadId: 'synthetic-thread',
      question: 'What date is stated?',
      selectedCaseIds: ['synthetic-case'],
      selectedDocumentIds: ['synthetic-document'],
      evidence: [{
        evidenceId: 'evidence-1', chunkId: 'synthetic-chunk', caseId: 'synthetic-case',
        documentId: 'synthetic-document', documentName: 'Synthetic Order.pdf', pageStart: 1, pageEnd: 1,
        excerpt: 'The synthetic hearing date is 12 September 2026.', localRank: -1,
      }],
      language: 'en',
      consent: { granted: true, version: AI_CONSENT_VERSION },
    },
  });
  const answerBody: unknown = answer.json();
  if (answer.statusCode !== 503 || !isAiApiErrorResponseDto(answerBody)
    || answerBody.error.code !== 'PROVIDER_NOT_CONFIGURED') {
    throw new Error('Provider-not-configured behavior failed.');
  }
  process.stdout.write('No-key backend smoke check passed: health is safe and online answers are disabled.\n');
} finally {
  await app.close();
}
