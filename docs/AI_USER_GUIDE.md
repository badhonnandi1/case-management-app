# AI Assistant User Guide

## What stays offline

The normal Case Management app works without internet: cases, hearing history, calendar, documents, reminders, Cause Lists, CSV export, backups, and Settings. AI document preparation and local search also happen on your phone.

Preparing a PDF does not upload it. Original PDFs, images, and file paths stay on the phone.

## Using local search

Open **AI**, choose the cases and documents, and prepare the selected digital PDFs. You can search prepared sources in airplane mode. Scanned/image-only PDFs will say that OCR is required; online OCR is not used.

## Asking an online question

The app first finds relevant text locally. Before the first online question for the current policy, it shows the exact selected excerpts and asks for consent. Only those selected excerpts and the question are sent to the configured backend—not complete documents.

The backend currently uses the Gemini API free tier, where submitted content may be used to improve Google’s products. Do not send confidential client information unless you are authorized and accept the provider’s terms.

AI answers may be incomplete or wrong and are not legal advice. Always open and check the numbered citations against the original document and cited page.

## Models, cancellation, and failures

Settings shows models approved by the backend administrator. You may choose only from that list. If a model is removed, refresh configuration and the app will use the backend default.

Use **Stop** while a request is active. A cancelled or failed question remains in the composer and no incomplete answer is saved. The free online service may sleep when unused. Use **Test Connection** (or the chat connection **Retry**) and wait while “Starting AI service—this may take up to a minute” is shown. Only retry the question after the connection succeeds; the app will not resend it automatically. Local search and the rest of the app remain available while the service starts or is unavailable.

## Privacy and local cleanup

In **Settings → AI Assistant** you can:

- Review the current data-use notice.
- Reset consent so the next online question asks again.
- Delete all local AI chats without deleting cases, documents, or reusable indexes.
- Delete local AI indexes without deleting original documents. Documents can be prepared again later.

There is no Gemini-key field on the phone. Key changes are performed by the administrator on the secure backend.

## Updating safely

Before updating, create a portable backup in **Settings → Backup, Export & Restore** and validate it. Install the newer APK over the existing app; do not uninstall first, because uninstalling deletes app data. If Android rejects the update, stop and contact the administrator—the APK may not have the same signing identity. Do not work around that warning by deleting the installed app.
