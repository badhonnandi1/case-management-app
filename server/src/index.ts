import { buildServerApp } from './app.js';
import { loadServerConfig } from './config.js';
import { GeminiAnswerProvider } from './provider/geminiProvider.js';

const config = loadServerConfig();
const provider = new GeminiAnswerProvider(
  config.onlineAnswersEnabled ? config.geminiApiKey : null,
);
const app = await buildServerApp({ config, provider });

let closing = false;
async function shutdown(signal: 'SIGTERM' | 'SIGINT'): Promise<void> {
  if (closing) return;
  closing = true;
  process.stdout.write(`${JSON.stringify({ event: 'server_stopping', signal })}\n`);
  try {
    await app.close();
    process.exitCode = 0;
  } catch {
    process.stderr.write(`${JSON.stringify({ event: 'server_stop_failed' })}\n`);
    process.exitCode = 1;
  }
}

process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });

try {
  await app.listen({ host: config.host, port: config.port });
  process.stdout.write(`${JSON.stringify({
    event: 'server_started',
    host: config.host,
    port: config.port,
    providerConfigured: provider.configured,
  })}\n`);
} catch {
  process.stderr.write(`${JSON.stringify({ event: 'server_start_failed' })}\n`);
  process.exitCode = 1;
}
