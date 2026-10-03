# Slip attachment, journal preview and OCR simplification

Completed the three agreed frontend refactors in the existing checkout. Production code across the seven callers and four new shared modules is 100 lines shorter.

## Changes

- `useSlipAttachment` and `SlipAttachmentField` replace duplicate state, file selection, upload, clear and status UI in `RecordPaymentWizard` and `RescheduleOverlay`. State still lives at each parent's lifetime. Draft restoration, quote-change resets, required/optional labels and payment validation stay in their original callers. The existing `useSlipUpload` transport and file restrictions are unchanged.
- `JournalPreviewTable` shares the journal lines and total/balance footer used by early payoff and repossession. Each caller retains its surrounding section and business actions. Amount formatting, blank nonpositive amounts and the server's balance flag are preserved; the component does not calculate or post accounting entries.
- `parseOcrAddress` and `serializeOcrAddress` share address parsing across customer creation, contract creation and document OCR updates. Callers explicitly preserve their existing differences: form addresses retain area prefixes, document updates strip them; unparsed form addresses remain raw strings, document updates retain the JSON `raw` field. Populated structured addresses still take precedence.

## Validation

- Existing focused baseline: 174 tests passed before refactoring.
- Added 16 behavioral tests for slip success/pending/failure/retry/clear/draft/validation, journal amounts and authoritative balance flags, and OCR compatibility. Focused suite: 190 tests across 26 files passed.
- Full frontend/shared tests: 2,960 passed (admin 2,800, shared 128, storefront 32).
- `LOCAL_PREVIEW_PORT=5207 npm run local:check`: PASS at 22:23 Bangkok, including API/Web types and lint, builds, managed preview refresh and desktop/mobile browser smoke flows. Source fingerprint: `41ab32302b9d48fc6aef2f8a31f1a987c7dba3cd92741147cda2c3d2b9e30e82`.
- Web TypeScript passed. Read-only reviewer compared all seven original files with the saved baseline and found no actionable issues. `git diff --check` passed.
- Differential check against the exact original OCR implementations: all 54 serialized results and eight customer-form objects match, including empty data, structured priority, field ordering, area prefixes and unparsed fallback.
- Chromium exercised the actual Reschedule overlay (storage failure, retry, display, clear, reselect), actual Payment wizard (upload/display/clear), and both actual early-payoff/repossession overlays (journal descriptions, amounts and balance). Uploaded file bytes matched the fixture.
- Chromium exercised the actual `useOcrFlow` hook: 27 address results matched the original implementation. Browser fixture reported no page errors or unexpected financial writes.

The additional browser checks mount real components/hooks with synthetic authentication and intercepted API/storage responses. They do not exercise a live OCR service/card reader, real object storage, customer persistence or financial posting. Default managed preview checks also use synthetic data/AI.

Artifacts: `.tmp/slip-journal-ocr-before.json`, `.tmp/slip-journal-ocr-focused-tests.log`, `.tmp/check-slip-journal-ocr.mjs`, `.tmp/slip-journal-ocr-browser.log`, `.tmp/slip-journal-ocr/`, `.tmp/local-preview/check.json`.

Local preview: <http://localhost:5207/inbox>. No commit, merge, deployment or external message send.
