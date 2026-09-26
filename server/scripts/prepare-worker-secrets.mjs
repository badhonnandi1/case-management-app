import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectDirectory = resolve(serverDirectory, '..');
const secretsDirectory = resolve(projectDirectory, '.secrets');
const ownerCodePath = resolve(secretsDirectory, 'owner-invite-code.txt');
const ownerSeedPath = resolve(secretsDirectory, 'owner-seed.sql');
const signingSecretPath = resolve(secretsDirectory, 'session-signing-secret.txt');
const localWorkerSecretsPath = resolve(serverDirectory, '.dev.vars');

mkdirSync(secretsDirectory, { recursive: true, mode: 0o700 });

const rotateOwner = process.argv.includes('--rotate-owner');
const ownerCode = rotateOwner
  ? writeGenerated(ownerCodePath, `cm_owner_${randomBytes(32).toString('base64url')}`)
  : readOrCreate(ownerCodePath, () => `cm_owner_${randomBytes(32).toString('base64url')}`);
const ownerHash = createHash('sha256').update(ownerCode, 'utf8').digest('base64url');
const seed = [
  'INSERT INTO testers (id, label, code_hash, active, created_at, revoked_at)',
  `SELECT '${randomUUID()}', 'Owner', '${ownerHash}', 1, unixepoch(), NULL`,
  `WHERE NOT EXISTS (SELECT 1 FROM testers WHERE label = 'Owner');`,
  `UPDATE testers SET code_hash = '${ownerHash}', active = 1, revoked_at = NULL WHERE label = 'Owner';`,
  "UPDATE sessions SET revoked_at = unixepoch() WHERE tester_id IN (SELECT id FROM testers WHERE label = 'Owner') AND revoked_at IS NULL;",
  '',
].join('\n');
writePrivate(ownerSeedPath, seed);

const sessionSigningSecret = readOrCreate(signingSecretPath, () => randomBytes(48).toString('base64url'));
const existingWorkerSecrets = parseDotEnv(readOptional(localWorkerSecretsPath));
const existingServerEnv = parseDotEnv(readOptional(resolve(serverDirectory, '.env')));
const geminiApiKey = existingWorkerSecrets.get('GEMINI_API_KEY') ?? existingServerEnv.get('GEMINI_API_KEY');
const groqApiKey = existingWorkerSecrets.get('GROQ_API_KEY') ?? existingServerEnv.get('GROQ_API_KEY');

const lines = [
  geminiApiKey ? `GEMINI_API_KEY=${geminiApiKey}` : null,
  groqApiKey ? `GROQ_API_KEY=${groqApiKey}` : null,
  `SESSION_SIGNING_SECRET=${sessionSigningSecret}`,
].filter((line) => line !== null);
writePrivate(localWorkerSecretsPath, `${lines.join('\n')}\n`);

function readOrCreate(path, factory) {
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  const value = factory();
  writePrivate(path, `${value}\n`);
  return value;
}

function writeGenerated(path, value) {
  writePrivate(path, `${value}\n`);
  return value;
}

function readOptional(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function parseDotEnv(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/u)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line.trim());
    if (!match) continue;
    const [, key, rawValue] = match;
    if (key && rawValue?.trim()) values.set(key, rawValue.trim().replace(/^['"]|['"]$/gu, ''));
  }
  return values;
}

function writePrivate(path, text) {
  writeFileSync(path, text, { encoding: 'utf8', mode: 0o600 });
}
