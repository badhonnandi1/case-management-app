# Codex Prompt — Case Management App v1.1

You have full access to this React Native/Expo Android case-management app. Implement and release version 1.1.0 while preserving every working v1.0 feature and all existing user data.

## Required changes

1. In Settings > Hearing Reminders, let the user choose a custom local notification time. Persist the selected time and reschedule existing eligible reminders when it changes. Do not reset the chosen time when reminders are toggled off/on.
2. Replace manual `YYYY-MM-DD` typing with an Android date-picker popup for every editable case/hearing date field, including Previous Date, Next Date, Hearing Date, and Next Hearing Date. Use the spinner/dropdown-style native date picker shown in the reference. Optional dates must support Clear; required dates must not.
3. Notification bodies must identify a case by case number, not case title. Keep court name and next-step context where available.
4. Add an Excel-compatible UTF-8 `.csv` export containing all current case fields and preserving Bangla text. Make it easy to share from Backup/Export/Restore. Keep the existing full restore archive separately because CSV cannot preserve attachments, hearing-history relationships, or settings. Clearly label the two choices so users understand the difference.
5. Replace the single Case Number input with three required sections:
   - Case Type, for example `LST`
   - Number, for example `45`
   - Year, for example `22`
   Compose and store the display value as `LST 45/22`. Existing v1.0 case numbers must remain readable and should be parsed into the three fields where possible when edited.
6. Add a required represented-side selection for Plaintiff/বাদী or Defendant/বিবাদী. Show it on case details and persist it.
7. Generate each Daily Cause List entry in this exact compact order:
   `কেস নম্বর(কোর্টের নাম) মামলার title - আমরা কোন পক্ষকে represent করি - today's step`
   Example: `LST 45/22(সদর) রহিমা vs করিম - বাদী - চূড়ান্ত শুনানি`
   Preserve correct HTML escaping and Bangla rendering in the PDF.
8. Set app version to `1.1.0`, Android version code to `2`, and increment the database schema safely.

## Safety and compatibility requirements

- Add a forward-only SQLite migration; never drop or recreate the user's case tables.
- Existing v1.0 records and v1.0 `.casebackup` archives must remain supported.
- Keep package ID `com.casemanagement.app` and use the existing signing identity so the APK installs as an upgrade.
- Do not remove case CRUD, hearing history, documents, calendar, cause-list PDF, reminders, restore, or storage tools.
- Validate all inputs and preserve existing transactional restore behavior.
- Keep the app offline-first; do not add analytics, cloud services, or network data transfer.

## Verification and deliverable

- Run TypeScript checking, SQLite tests, pure-logic tests, backup/restore tests, Expo dependency validation, Expo Doctor, and a production Android bundle.
- Build a signed ARM64 release APK.
- Verify package ID, version name/code, minimum SDK, APK signature, and SHA-256 checksum.
- Place the final artifact at `release/Case-Management-v1.1.0.apk`.
