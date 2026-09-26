# Case Management AI backend

The recommended testing deployment is the Cloudflare Worker in `src/worker/`, backed by D1 only for tester access, revocable sessions, request replay prevention, rate counters, and provider circuit state. Questions, evidence, document/case metadata, prompts, answers, and citation text are never persisted. The original Fastify server remains available for local development.

## Cloudflare testing architecture

- Worker: `case-management-ai` on the Workers Free plan.
- D1: `case-management-ai-limits`, binding `DB`, with `migrations/0001_security.sql`.
- Public API: `GET /health`, `GET /api/v1/config`, `POST /api/v1/sessions`, `POST /api/v1/answers`.
- Access: a high-entropy invite code is submitted in a small JSON body, SHA-256 hashed before D1 lookup, and never placed in a URL/header. Sessions are signed, short-lived, stored in D1, and revocable.
- AI routing: Gemini is primary and Groq is fallback. Mobile sees only the logical model `balanced` / `Balanced`.
- Fallback: only timeout, HTTP 429, retryable network errors, or provider 5xx. Client/provider 4xx, safety refusal, bad input, invalid schema, and citation failure do not fall back.
- Output: buffered JSON for this test release. Both providers use the same evidence-only prompt, response schema, and server-side citation resolver.
- Limits: 3 requests/tester/minute, 10/tester/day, 50 globally/day, 64 KiB request body, eight excerpts, and 1,024 output tokens. D1 batch-transaction enforcement is atomic and fails closed.
- Browser CORS: disabled. Requests with an `Origin` header are rejected; the intended client is native Android.

## Local setup and verification

Install and run the non-provider checks:

```sh
npm install
npm run check
npm test
npm run build
npm run worker:migrate:local
npm run worker:dry-run
```

Prepare ignored local secrets and the initial Owner invite without printing values:

```sh
npm run worker:secrets:prepare
```

This creates mode-0600 files under `../.secrets/` and an ignored `.dev.vars`. If a Gemini key exists in ignored `server/.env`, it is copied locally into `.dev.vars`. Add a Groq key to `.dev.vars` using a local editor or password manager; never paste it into chat or a tracked file.

Run direct, synthetic provider checks only after both keys are configured:

```sh
npm run worker:smoke:gemini
npm run worker:smoke:groq
```

These scripts print only route/validation/citation IDs and token metadata—not prompts, evidence text, answers, or keys.

## Deployment

Authenticate with OAuth and confirm the selected account is free:

```sh
npx wrangler login
npx wrangler whoami
```

Create D1 once, replace the placeholder `database_id` in `wrangler.jsonc` with the returned non-secret UUID, then migrate and seed it:

```sh
npx wrangler d1 create case-management-ai-limits
npm run worker:migrate:remote
npx wrangler d1 execute DB --remote --file ../.secrets/owner-seed.sql
```

Upload only the three secrets from ignored `.dev.vars`, then deploy:

```sh
npx wrangler secret bulk .dev.vars
npm run worker:deploy
```

Never put `GEMINI_API_KEY`, `GROQ_API_KEY`, `SESSION_SIGNING_SECRET`, or the raw Owner invite into `wrangler.jsonc`, examples, source code, logs, mobile configuration, or an APK. The Worker URL is public and is the only backend value later compiled into Android.

## Provider privacy controls

Keep the Gemini API project unbilled and within its free quota. Free-tier Gemini content may be used by Google to improve products, which is disclosed by the versioned app consent text. Keep the Groq organization on its Free plan. Zero Data Retention is an organization setting that must be reviewed and enabled manually in the Groq Console under Data Controls when the account offers it; verify the setting before inviting testers.

## Legacy Fastify development server

`npm run dev:env` loads ignored `server/.env`; `npm run dev` uses the process environment. The Fastify routes remain contract-compatible and now expose only the logical `balanced` model. This path has in-memory mitigation and is not the recommended public test deployment.

The mobile backend URL is non-secret:

```sh
EXPO_PUBLIC_AI_BACKEND_URL=https://case-management-ai.<workers-subdomain>.workers.dev
```

Online AI remains disabled in the current APK until Stage 3.
