import assert from 'node:assert/strict';
import test from 'node:test';

import { loadServerConfig } from '../src/config.js';

const productionSecret = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

test('server model configuration is allowlisted and backward compatible', () => {
  const config = loadServerConfig({
    NODE_ENV: 'test',
    GEMINI_DEFAULT_MODEL: 'gemini-3.8-flash',
    GEMINI_ALLOWED_MODELS: 'gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.8-flash',
  });
  assert.equal(config.geminiDefaultModel, 'gemini-3.8-flash');
  assert.deepEqual(config.geminiAllowedModels, ['gemini-3.8-flash', 'gemini-3.5-flash-lite']);
  assert.equal(loadServerConfig({ NODE_ENV: 'test', GEMINI_MODEL: 'gemini-3.7-flash' }).geminiDefaultModel, 'gemini-3.7-flash');
});

test('production startup requires separate Gemini and session-signing secrets', () => {
  assert.throws(
    () => loadServerConfig({ NODE_ENV: 'production', GEMINI_API_KEY: 'configured' }),
    /SESSION_SIGNING_SECRET/,
  );
  assert.throws(
    () => loadServerConfig({ NODE_ENV: 'production', SESSION_SIGNING_SECRET: productionSecret }),
    /GEMINI_API_KEY/,
  );
  const config = loadServerConfig({
    NODE_ENV: 'production',
    GEMINI_API_KEY: 'configured',
    SESSION_SIGNING_SECRET: productionSecret,
  });
  assert.equal(config.production, true);
  assert.equal(config.geminiApiKey, 'configured');
  assert.equal(config.sessionSigningSecret, productionSecret);
});

test('online answers can be administratively disabled without changing mobile code', () => {
  const config = loadServerConfig({
    NODE_ENV: 'production',
    AI_ONLINE_ENABLED: 'false',
    SESSION_SIGNING_SECRET: productionSecret,
  });
  assert.equal(config.onlineAnswersEnabled, false);
  assert.equal(config.geminiApiKey, null);
});

test('Render runtime binds externally and honors the platform-provided port', () => {
  const config = loadServerConfig({
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    PORT: '12345',
    TRUST_PROXY: 'true',
    GEMINI_API_KEY: 'configured',
    SESSION_SIGNING_SECRET: productionSecret,
  });
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 12345);
  assert.equal(config.trustProxy, true);
});

test('invalid or excessive model allowlists fail startup validation', () => {
  assert.throws(
    () => loadServerConfig({ NODE_ENV: 'test', GEMINI_ALLOWED_MODELS: 'not-a-provider-model' }),
    /GEMINI_ALLOWED_MODELS/,
  );
  assert.throws(
    () => loadServerConfig({ NODE_ENV: 'test', GEMINI_ALLOWED_MODELS: Array.from({ length: 9 }, (_, index) => `gemini-test-${index}`).join(',') }),
    /GEMINI_ALLOWED_MODELS/,
  );
});
