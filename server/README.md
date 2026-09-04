# Case Management AI server

This is a separately deployable, provider-neutral HTTP boundary for optional online answers. The Android app keeps indexing and local search on-device. Only excerpts explicitly selected from local search are eligible for this API; PDFs, images, file paths, the SQLite database, and unrelated records are not accepted by the contract.

## Runtime and setup

- Node.js 20 or newer (Node 22 or newer is recommended for deployment).
- Install independently with `npm install` inside `server/`.
- Copy `.env.example` to the ignored `server/.env` only for local development. Never commit `.env`.
- Run without loading a file using runtime environment variables and `npm run dev`, or use the local ignored file with `npm run dev:env`.
- Validate with `npm run check`, `npm test`, `npm run build`, and `npm run smoke:no-key`.

The official `@google/genai` package is used only by this server. Its documentation explicitly warns against exposing API keys in client-side code: <https://googleapis.github.io/js-genai/>. Structured JSON output uses the SDK's `responseMimeType` and `responseJsonSchema` options described in the official API reference. The stable default model `gemini-3.8-flash` was verified on 2026-09-04 and supports structured output: <https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash>.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | For live answers | Backend-only Google AI Studio Gemini API secret. |
| `SESSION_SIGNING_SECRET` | Production | Independent base64url secret of at least 32 random bytes for anonymous-session signatures. |
| `GEMINI_DEFAULT_MODEL` | No | Server-owned default; currently `gemini-3.8-flash`. |
| `GEMINI_ALLOWED_MODELS` | No | Comma-separated allowlist containing the default. Arbitrary client models are rejected. |
| `AI_ONLINE_ENABLED` | No | Administrative emergency switch; defaults to `true`. |
| `AI_PRIVACY_POLICY_ID`, `AI_CONSENT_POLICY_VERSION` | No | Trusted policy identifiers. Material changes require a new consent version. |
| `HOST`, `PORT` | No | Listening address and port. |
| `NODE_ENV` | Production deployment | Enables application-layer HTTPS enforcement. |
| `TRUST_PROXY` | Behind a trusted proxy | Lets Fastify honor the trusted proxy protocol value. |
| `ALLOWED_ORIGINS` | For browser clients | Comma-separated exact HTTPS origins. Native Android requests normally have no `Origin`. |
| `PROVIDER_TIMEOUT_MS` | No | Provider deadline, default 30 seconds. |
| `ANSWER_RATE_LIMIT_PER_MINUTE` | No | Anonymous session answer limit, default 10. |
| `IP_RATE_LIMIT_PER_MINUTE` | No | Answer limit per observed IP, default 30. |
| `SESSION_ISSUE_LIMIT_PER_MINUTE` | No | Session issuance limit per observed IP, default 10. |
| `SESSION_TTL_SECONDS` | No | Anonymous session lifetime, default 15 minutes. |

`GEMINI_API_KEY` and `SESSION_SIGNING_SECRET` are read only by the server. They are never returned, logged, persisted, or shared with mobile code. Do not put either in an `EXPO_PUBLIC_*` variable. For local work, enter secrets into the ignored `server/.env` using a local editor or password-manager injection rather than source code or chat. On Render, enter both directly as secret environment variables in the service Dashboard; see `../docs/ADMIN_GUIDE.md`.

The mobile app's non-secret base URL is configured separately as `EXPO_PUBLIC_AI_BACKEND_URL=https://your-backend.example`. Production mobile builds reject plain HTTP URLs. Removing that variable disables online answers without changing local preparation, search, case management, or backups.

## API and privacy boundary

- `GET /health` reports only API readiness and whether the provider is configured.
- `GET /api/v1/config` reports only the provider display name, approved model list/default, conservative privacy policy, public limits, feature status, and contract version.
- `POST /api/v1/sessions` issues a signed, short-lived anonymous token held only in mobile memory.
- `POST /api/v1/answers` requires that bearer token, `application/json`, explicit consent metadata, selected case/document IDs, and at most eight scoped excerpts.
- A requested model is optional for older-client compatibility. The backend default is used when omitted; when present it must belong to the server allowlist.
- Request bodies are capped at 64 KiB. Question, scope, per-excerpt, total-evidence, page, identifier, and unknown-field validation occurs before Gemini is called.
- The prompt treats excerpts as untrusted data and forbids general knowledge, web retrieval, tools, scope expansion, and fabricated facts/citations.
- Model output is schema-validated. Citation IDs are resolved against the submitted excerpts; document names/pages/IDs are copied from trusted request metadata, never model output.
- No request, excerpt, question, document name, answer, token, or raw provider error is logged or persisted. There is no server database.
- Logs contain only request ID, route, status, duration, payload size, evidence count, normalized error category, provider latency, and returned token counts.

The currently configured project uses unpaid Gemini API quota. Under Google's current Gemini API terms, submitted inputs and generated responses for unpaid services may be used to provide, improve, and develop Google products, and users are instructed not to submit sensitive, confidential, or personal information. The Android consent flow therefore uses the conservative free-tier warning. The public configuration accepts only the conservative tier in this release; client configuration cannot declare private processing.

## Security and deployment

Production must terminate HTTPS at a trusted reverse proxy or managed platform and prevent direct public access to an unencrypted listener. Set `NODE_ENV=production` and configure trusted proxy handling for that platform. Browser CORS is an exact allowlist; CORS is not authentication and does not constrain native clients.

The current abuse layer is deliberately described as anonymous mitigation, not strong authentication: signed short-lived sessions, request replay protection, per-session limits, and observed-IP limits are held in one server process. They reset on restart and do not coordinate across replicas. Before public/high-volume use, place the service behind a managed API gateway/shared rate-limit store and consider real user authentication, Play Integrity, or Firebase App Check. Those require product/account choices and are not configured here.

The production target is one stateless Render Free Docker Web Service in Singapore. `render.yaml` keeps automatic deploys off, declares only non-secret policy values, and prompts for both secrets in the Render Dashboard. Render supplies `PORT`; the container listens on `0.0.0.0`, runs as a non-root user, and writes no application state to its ephemeral filesystem. Free services sleep after inactivity, so the mobile connection test performs bounded health-only wake probes and never automatically resends a question. See `../docs/ADMIN_GUIDE.md`.

## Verification

`npm run smoke:no-key` confirms that health is safe and answer requests return `PROVIDER_NOT_CONFIGURED` without making a provider call. After securely configuring a real key in `server/.env`, run exactly one synthetic call with `npm run smoke:live`. The script uses fictional evidence and prints only model/token metadata and the resolved opaque citation ID—not the question, excerpt, answer, or secret.
