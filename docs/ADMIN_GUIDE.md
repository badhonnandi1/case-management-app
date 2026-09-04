# Case Management AI Administrator Guide

This guide covers the optional online AI backend on a Render Free Web Service. Normal case management, document storage, reminders, backup/restore, local PDF preparation, and local search remain on the Android device and do not depend on Render.

## Production design

- Blueprint: `render.yaml`
- Service name: `case-management-ai`
- Service type: one public Docker Web Service
- Plan: Free
- Region: Singapore, the nearest available Render region for Bangladesh
- Health path: `/health`
- Automatic deploys: Off; deploy only a reviewed commit manually
- Runtime: stateless Node 22 container, non-root user, ephemeral filesystem only
- No Render Postgres, Key Value/Redis, disk, worker, cron job, background service, or paid add-on
- Secrets: service-level secret environment variables entered only in the Render Dashboard

The mobile app needs the generated public `https://*.onrender.com` URL. Anyone who discovers it can request an anonymous session. Session/IP limits, payload limits, replay protection, provider quotas, and the single Free instance reduce abuse but do not establish user identity or guarantee a hard spending cap. Native Android clients are not protected by browser CORS, and no privileged static credential is embedded in the APK.

## Free-service behavior

Render Free Web Services spin down after 15 minutes without inbound traffic. The first later HTTP request wakes the service and startup can take about one minute. The app's **Test Connection** and chat **Retry** connection action perform bounded `/health` probes for up to 70 seconds and display “Starting AI service—this may take up to a minute.” They never create a session or resend an AI question. The user must retry the question after health succeeds. Local search remains available throughout.

The service filesystem is ephemeral and is not used for application state. Anonymous session tokens are HMAC-signed and remain verifiable after restart while the same `SESSION_SIGNING_SECRET` is configured. In-memory rate and replay counters reset when Render restarts the service, so strict limits remain enabled but their previous in-memory history does not survive a restart.

## Private GitHub repository

The current workspace has no Git metadata. Do not initialize it or push anywhere until the owner explicitly authorizes the target private repository.

Safest setup:

1. In GitHub, create a new **Private** repository. Do not initialize it with a README, license, or `.gitignore`.
2. Enable two-factor authentication on the GitHub account.
3. Provide only the repository owner/name or URL—not a password, personal-access token, browser cookie, or SSH private key.
4. After explicit authorization, initialize Git locally, inspect every staged path, and confirm that `server/.env`, signing stores, APKs, build output, and confidential fixtures are absent before the first commit.
5. Push only the reviewed default branch.
6. In Render, install/authorize the Render GitHub App for **only this repository**, not every private repository.

The intended commands after authorization are:

```sh
git init
git add .
git status --short
git commit -m "Prepare Case Management AI for Render"
git branch -M main
git remote add origin TARGET_PRIVATE_REPOSITORY_URL
git push -u origin main
```

Authentication must be completed through GitHub's own browser/device flow or an already configured credential helper. Never paste a GitHub credential into chat or source files.

## Render Blueprint setup

1. Sign in at the Render Dashboard.
2. Open **Blueprints** and choose **New Blueprint Instance**.
3. Connect the authorized private GitHub repository and select its reviewed default branch.
4. Use the root `render.yaml`.
5. Verify the preview contains exactly one resource:
   - Type: Web Service
   - Runtime: Docker
   - Plan: Free
   - Region: Singapore
   - Health check: `/health`
   - No databases, Key Value/Redis, disks, workers, or cron jobs
6. Verify **Auto-Deploy** is **Off**. Keep it off after creation and trigger future deploys manually from reviewed commits.
7. Enter the two prompted secret values directly in Render. Do not use **Add from .env**, and do not put either value in `render.yaml`.
8. Apply the Blueprint and wait for the deploy to become Live.

Render supplies `PORT`; do not create or override it. The Blueprint sets `HOST=0.0.0.0`, and the server reads Render's supplied `PORT`. `TRUST_PROXY=true` is required because Render terminates public HTTPS before forwarding to Fastify.

## Secret entry

Required dashboard-only variables:

- `GEMINI_API_KEY`
- `SESSION_SIGNING_SECRET`

The signing secret must be independent of the Gemini key and decode to at least 32 random bytes. On macOS, an administrator can generate a base64url value directly into the clipboard without printing it:

```sh
openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n' | pbcopy
```

Paste it directly into the `SESSION_SIGNING_SECRET` field in Render, then clear the clipboard. Do not save it in shell history, GitHub, `.env.example`, source, documentation, mobile storage, or the APK.

Create or retrieve the Gemini key in Google AI Studio and paste it directly into Render's `GEMINI_API_KEY` field. Because a key-shaped string previously appeared in an example file and repository history is unavailable, treat that earlier value as potentially exposed. If it was genuine, revoke it and create a replacement before deployment. Never paste the key into chat.

## Non-secret deployment configuration

The Blueprint safely defines:

- `GEMINI_DEFAULT_MODEL`
- `GEMINI_ALLOWED_MODELS`
- `AI_ONLINE_ENABLED`
- `AI_PRIVACY_POLICY_ID`
- `AI_CONSENT_POLICY_VERSION`
- Session, request, IP, timeout, body, and evidence limits

The server validates configuration at startup. The default model must appear in the comma-separated allowlist. Changing models or privacy policy requires a reviewed commit/Blueprint sync or a controlled dashboard environment update followed by a manual deploy. The phone cannot edit these variables or submit an arbitrary model.

A material privacy/provider/tier change must update both `AI_PRIVACY_POLICY_ID` and `AI_CONSENT_POLICY_VERSION`. The server then rejects old consent and the app asks again. Do not remove the conservative free-tier warning unless current provider terms have been verified.

## Deployment verification

After the service becomes Live:

1. Copy its generated HTTPS URL, such as `https://case-management-ai-xxxx.onrender.com`.
2. Confirm `GET /health` returns only API availability/version fields.
3. Confirm `GET /api/v1/config` returns only provider/model allowlist, privacy policy, public limits, feature availability, and contract version.
4. Confirm an arbitrary model ID and stale consent version are rejected.
5. Confirm oversized bodies, empty evidence, invalid citations, and unsupported content types are rejected.
6. Let the service sleep when practical, then verify **Test Connection** wakes it without sending an answer request.
7. Perform one synthetic, non-confidential Gemini answer and confirm only supplied synthetic citation IDs resolve.
8. Inspect Render logs. Permitted fields are request ID, endpoint, status, duration, payload size, evidence count, normalized error, provider latency, and token totals. Questions, excerpts, answers, case/document names, paths, session tokens, and secrets must not appear.
9. Verify Auto-Deploy remains Off and the plan remains Free.

Use the minimum live Gemini calls needed for verification. Do not enable file uploads, online OCR, web/legal search, grounding, or external retrieval.

## Mobile backend URL

Use the exact generated Render HTTPS origin at release build time:

```sh
EXPO_PUBLIC_AI_BACKEND_URL=https://SERVICE-NAME.onrender.com
```

This URL is public configuration, not a credential. Production validates HTTPS, rejects user information/query/fragment components, and has no arbitrary backend URL editor. The final APK must contain the intended Render URL and no localhost, development endpoint, Gemini key, session-signing secret, or privileged credential.

## Rotation and incident response

Gemini-key rotation:

1. Create a replacement key in Google AI Studio.
2. In Render, open the service's **Environment** page and replace `GEMINI_API_KEY` directly.
3. Choose **Save and deploy** so a new service deployment uses it.
4. Run one synthetic, non-confidential verification.
5. Revoke the old key only after success.
6. Inspect sanitized logs and confirm the old key is no longer in use.

Session-secret rotation uses the same Render environment flow. It intentionally invalidates existing anonymous sessions; clients obtain a new session automatically. Never reuse the Gemini key.

For a suspected leak, first set `AI_ONLINE_ENABLED=false` and manually deploy if immediate containment is needed. Revoke the exposed Gemini key, replace it in Render, verify synthetically, and only then re-enable online answers. Offline app features and local AI search remain available.

## Free-plan limits and cost controls

- Keep exactly one Free Web Service.
- Do not add databases, Key Value/Redis, disks, workers, cron jobs, private services, paid observability, or other paid resources.
- Render Free has monthly instance-hour, build-minute, and bandwidth allowances. Exhausting them can suspend or limit the service; outbound Gemini traffic counts toward usage.
- Keep Gemini API quotas conservative where Google AI Studio permits. Do not raise quotas automatically.
- Free-plan sleeping reduces idle usage but is not a hard spending cap for Gemini or excess platform usage.
- Review Render usage and Gemini quotas periodically. Do not add synthetic keep-alive traffic, because that defeats sleeping and can consume Free hours.

## Manual deploy and rollback

With Auto-Deploy Off, push alone does not deploy. In Render, open the service and use **Manual Deploy → Deploy latest commit** only after reviewing the commit and passing tests.

For rollback, open **Deploys**, select one of Render Free's retained recent successful deploys, and redeploy it. Recheck `/health`, `/api/v1/config`, sanitized logs, and one synthetic request. If the old deployment has incompatible privacy wording, keep `AI_ONLINE_ENABLED=false` until consent behavior is accurate.

## Android release and signing

Version 1.2.0 uses version code 3 and package `com.casemanagement.app`. Release signing reads only:

- `CASE_MANAGEMENT_RELEASE_STORE_FILE`
- `CASE_MANAGEMENT_RELEASE_STORE_PASSWORD`
- `CASE_MANAGEMENT_RELEASE_KEY_ALIAS`
- `CASE_MANAGEMENT_RELEASE_KEY_PASSWORD`

Keep the keystore outside the repository and enter passwords only through a secure local environment. Release assembly fails when these are absent and never falls back to debug signing. Increase version code for every later release and verify the certificate SHA-256 against the installed/prior production APK before upgrading.

The supplied 1.0.0 and 1.1.0 APKs use the repository debug certificate. That is not acceptable as a new production signing identity, but changing certificates prevents a direct Android package upgrade. Inspect the actually installed phone app and resolve the signing strategy before producing the final APK. Never uninstall or delete app data as a shortcut.

Before installing an update, create and validate a portable backup. Install the same-package, higher-version-code, same-certificate APK over the old app without uninstalling. Verify cases, histories, documents, reminders, backups, database migration, offline features, and AI features on-device.
