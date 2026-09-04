# Case Management

Case Management is an Android-only, offline-first case-management and court-diary app for lawyers. It uses Expo, React Native, TypeScript, React Navigation, and SQLite. V1 supports case CRUD, hearing history, a monthly hearing calendar, local PDF/image attachments, Daily Cause List PDFs, local hearing reminders, portable backups, and storage-health tools.

The optional AI Assistant adds local PDF preparation/search and an opt-in online evidence-grounded answer flow. Production administration, Render Free deployment, signing, recovery, and rotation are documented in [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md). The non-technical user workflow is in [docs/AI_USER_GUIDE.md](docs/AI_USER_GUIDE.md).

Version 1.1 adds custom reminder times, native date pickers, structured case numbers, represented-side tracking, compact Bangla-ready Cause List entries, and Excel-compatible CSV export.

## Requirements

- Node.js 24 or another version supported by Expo SDK 57
- npm
- Android Studio with the Android SDK and platform tools
- An Android emulator, or a connected Android device with USB debugging enabled

## Install and validate

```bash
npm install
npm run typecheck
npm run test:sqlite
npm run test:pure
npm run test:backup
npm run test:ai
npm run test:ai-ui
npm run test:ai-online
npm run test:ai-chat
npm run doctor
npx expo install --check
```

Create a production JavaScript export with:

```bash
npx expo export --platform android
```

## Run on Android

In Android Studio, open **Device Manager**, create or select an Android Virtual Device, and start it. Confirm that it is visible:

```bash
adb devices
```

Then launch the app:

```bash
npm run android
```

`npm start` starts Expo without automatically opening Android.

## Install APK on Android

The private v1.1 APK is available at `release/Case-Management-v1.1.0.apk` and supports ARM64 Android devices (Android 7.0/API 24 or newer).

1. Copy `Case-Management-v1.1.0.apk` to the Android phone.
2. Open the APK from the phone's file browser or downloads list.
3. If Android blocks the installation, enable **Install unknown apps** for the file browser or browser used to open it.
4. Tap **Install**.
5. Open **Case Management**.

**Important:** Before uninstalling the app or clearing app data, create and export a backup from Settings because all case data and attachments are stored locally.

This private-install artifact is a release build signed with the generated Android debug identity. For normal future upgrades, keep the package ID `com.casemanagement.app` and use the same signing identity. Increment both `version` and `android.versionCode` (for example, `1.0.1` and version code `2`). Do not uninstall the existing app for a normal upgrade, because uninstalling can remove its local data.

For production distribution, configure and securely retain a dedicated release keystore or EAS signing credentials; do not publish a debug-signed artifact.

## Local data and privacy

- SQLite stores cases, hearing history, document metadata, settings, and reminder mappings.
- Attached PDFs/images, generated Cause Lists, and backups are stored in app-controlled local storage.
- Core case management has no authentication, cloud sync, analytics, or telemetry and remains offline. The optional AI-answer foundation can send only user-approved, selected text excerpts to a separately configured backend; it never uploads original PDFs or images. Without that backend URL and explicit consent, no excerpt leaves the device.
- Sharing a document, Cause List, or backup only occurs after the user explicitly opens the Android share sheet.

**Uninstalling the app or clearing app data may remove local cases and attachments. Create a backup and export it from the device first.**

Development builds seed five sample cases only when the local `cases` table is empty.

## Backup format

Settings > Backup, Export & Restore provides an Excel-compatible UTF-8 CSV for readable case-data sharing. The separate full restore backup remains necessary for lossless recovery of case history, attachments, and settings.

Backups are versioned `.casebackup` ZIP archives stored under the app-managed `backups` directory. Each contains:

```text
manifest.json
data.json
documents/cases/{caseId}/{documentId}.{extension}
```

The structured data includes cases, hearing history, existing document files and metadata, and reminder preferences. It preserves record IDs and uses portable archive paths; restore remaps attachments to the new app sandbox. Missing physical attachments are skipped with a visible warning.

Generated Daily Cause List PDFs are excluded because they can be regenerated. Device-specific scheduled-notification identifiers are also excluded; reminders are reconciled and assigned fresh identifiers after restore.

Restore validates the entire archive and stages files before asking for destructive confirmation. V1 uses deterministic replace-all restore inside a SQLite transaction; it does not merge records.

Backup files can contain confidential legal information. Store and share them securely.

## Project layout

```text
src/
  components/      Reusable professional UI
  database/        SQLite initialization, schema, migrations, seed
  models/          Strongly typed application and backup models
  navigation/      Typed tab and stack navigation
  repositories/    Parameterized SQLite data access
  screens/         Application screens
  services/        Files, documents, PDFs, reminders, backups, storage
  theme/           Color, spacing, radius, and typography tokens
  utils/           Date, file, backup, storage, and reminder logic
scripts/            Executable pure and SQLite contract tests
shared/             Provider-neutral mobile/server AI API contract
server/             Separately installed and deployable online-answer backend
```

## Optional evidence-grounded AI conversations

The AI tab is lazy: opening the app or another tab does not initialize AI indexes or contact the backend. A prepared thread stores only its selected case/document relationships and local chat history. Opening history validates current local files and hashes but makes no online request. Preparing documents and local search also remain offline.

For an online question, the app follows this fixed flow:

1. Reload the thread scope and remove deleted relationships.
2. Recheck each selected file and parser version; changed or missing sources are excluded until re-indexed.
3. Run SQLite FTS5/BM25 locally with both the selected case IDs and ready selected document IDs.
4. Deduplicate and revalidate no more than eight matching chunks.
5. Show consent for the current provider/tier/transmission-policy version when needed.
6. Send the question, selected scope IDs, document display names, page ranges, local ranks, and only those selected text excerpts to the separate backend.
7. Accept only a contract-valid answer whose citations resolve exactly to submitted evidence.
8. Save the user message, assistant message, and citations in one local SQLite transaction.

Original PDFs/images, file paths, unselected chunks, complete extracted documents, the SQLite database, reminder data, and backend credentials are never part of the answer request. Anonymous session tokens remain in memory. Failed, cancelled, empty-retrieval, or citation-invalid attempts are not saved as normal messages.

The configured project currently uses the Gemini API free tier. The consent sheet therefore warns that submitted content may be used to improve Google products and tells users not to send confidential client information unless authorized and willing to accept the provider terms. Consent is unchecked initially, stored locally only as a policy-version string, reviewable from the thread menu, and resettable without deleting chats or indexes. A provider/tier/transmission change must use a new consent version. Purely local search never requires consent.

Answers render as selectable plain text—never executable HTML, remote images, or embedded web content. Citations use only backend-validated IDs and locally persisted page metadata. Before opening a citation, the app verifies the document record, physical file, current hash/parser state, chunk ownership, and page range. The external Android PDF viewer cannot be reliably page-positioned, so the app displays the exact cited page and asks the user to navigate there rather than pretending to jump.

Chat history and citations remain on-device and are excluded from portable backups by default. Clearing a conversation or deleting a thread does not delete reusable indexes, original files, or case data. Deleting indexes leaves original documents intact. Re-indexing may invalidate old chunk citations; those answers are retained and visibly marked when no active saved citation remains.

### Mobile backend URL

Install and configure the backend separately using `server/README.md`. The only mobile environment value is the non-secret public base URL:

```bash
EXPO_PUBLIC_AI_BACKEND_URL=https://ai-api.example.com npx expo start --clear
```

Leaving it unset enables local-only mode. Production builds require HTTPS. For an Android emulator talking to a backend on the development computer, use `http://10.0.2.2:8787` in a development build. A physical device must use a LAN-reachable computer address while both devices are on the same network, or a properly secured HTTPS endpoint; `localhost` on the phone refers to the phone. Android cleartext HTTP is development-only and may also require native network-security configuration, so HTTPS is required for production.

Backend availability is checked only before sending or after a manual retry—not at global startup and not continuously. **Test Connection** and the chat connection retry can wake a sleeping Render Free service with bounded health-only checks for up to 70 seconds. They never automatically resend a question. Device offline, URL missing/invalid, unreachable backend, provider-not-configured, timeout, rate-limit, cancellation, and provider failures are shown separately while local indexing/search and all case-management features continue working.

### Current limitations and Prompt 5 prerequisites

- Local OCR is still not configured; scanned PDFs/images remain marked as requiring OCR.
- Exact PDF page jumping depends on the external viewer and is not claimed.
- Conversations are linear. Regeneration appends a newer assistant answer without duplicating or overwriting the original user message.
- Provider warnings are shown for the current response but the existing schema does not persist a separate warnings field.
- The prepared target is one stateless Render Free Docker Web Service from a private GitHub repository. Deployment, dashboard-only secret entry, the final `onrender.com` URL, signing, and physical-device acceptance remain gated actions. A final release APK is intentionally not created until those checks are complete.
