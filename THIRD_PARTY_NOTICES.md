# Third-party notices

## PdfBox-Android

- Artifact: `com.tom-roush:pdfbox-android:2.0.27.0`
- Purpose: read-only, on-device extraction of selectable PDF text by page
- Source: https://github.com/TomRoush/PdfBox-Android
- License: Apache License 2.0

PdfBox-Android is not used to render or modify source documents. Its optional
JPX/JPEG2000 image decoder is not included because image decoding is not needed
for selectable-text extraction.

## noble-hashes

- Package: `@noble/hashes@2.0.1`
- Purpose: incremental SHA-256 hashing without loading an entire file at once
- Source: https://github.com/paulmillr/noble-hashes
- License: MIT

## Expo Clipboard

- Package: `expo-clipboard@57.0.1`
- Purpose: user-initiated copying of locally displayed AI answer text
- Source: https://github.com/expo/expo/tree/main/packages/expo-clipboard
- License: MIT

## Google Gen AI JavaScript SDK (server only)

- Package: `@google/genai@2.21.0`
- Purpose: backend-only Gemini structured answer calls
- Source: https://github.com/googleapis/js-genai
- License: Apache License 2.0

This package is installed only under `server/` and is not a mobile dependency.

## Fastify and Zod (server only)

- Packages: `fastify@5.12.1`, `@fastify/cors@11.3.0`, `zod@4.5.4`
- Purpose: isolated HTTP routing, CORS enforcement, and strict request/response validation
- Licenses: MIT
