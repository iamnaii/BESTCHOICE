# Broadcast and integration follow-up — 2026-10-03

Continuation of the [code simplification](2026-10-03-code-simplification.md), authorized by the owner. All changes remain local; no production database migration, deployment or external message was performed.

## Changes

- Broadcast video uses a dedicated MP4 multipart endpoint (10 MB application limit), with a separate JPEG/PNG thumbnail endpoint (1 MB). Image upload remains separate. The API checks actual file signatures; stored image MIME/extension comes from bytes. Missing public storage now returns an explicit error instead of a URL that does not exist.
- Upload completion merges into the latest editor state, preserving simultaneous video/thumbnail uploads and text edits. Composer rendering no longer remounts its editors on every keystroke.
- Composer audience keys, message payloads and history now match the actual API. Video becomes a LINE video payload; image, Flex and rich formats use their matching fields. Unknown audience/message formats fail before saving. “All” explicitly means all LINE OA followers; the UI no longer presents the linked-customer count as the follower count.
- Creation saves a pending approval. A different user reviews every message and the schedule before approving. Conditional database updates prevent competing approvals from dispatching twice and coordinate approval, rejection, cancellation and the scheduler. Token lookup failures record `FAILED`; failed cancellation displays the API's reason and refreshes history.
- Migration `20261003210000_broadcast_multi_message_payload` reconciles the existing Prisma `messages` field with databases created by the older single-message migration. It backfills legacy rows, preserves existing multi-message payloads and old columns, and relaxes the legacy required fields. Tests cover fresh migrations, upgrade with existing data, repeat execution, and schema-synced tables. Apply this migration as part of a future deployment; it has only been applied to disposable test databases here.
- Customer360 regression tests now cover changing sections/bare mode on an already mounted panel, hidden query invalidation, and MDM missing-row/error/retry paths.

The media constraints were checked against the [official LINE message reference](https://developers.line.biz/en/reference/messaging-api/#video-message). The app's 10 MB video limit is intentionally lower than LINE's maximum.

## Verification

- Isolated PostgreSQL: **664 API tests across 40 suites**, plus **123 Broadcast/INTER-CO/contract-exchange integration tests across 6 files**, using disposable SHOP and FINANCE databases. No inherited application database is used.
- Full frontend/shared suites: **2,723 admin-web tests (365 files), 128 shared tests (11 files), and 32 storefront tests (7 files)** passed. Combined with the targeted API/integration coverage above, this is **3,670 tests**; focused reruns are not counted twice.
- Real browser integration: actual admin UI → Nest multipart controller → real StorageService/S3 SDK → local HTTPS object-store fixture → isolated Prisma/PostgreSQL pending record → second-user approval → captured LINE payload. A browser-recorded, playable MP4 was uploaded and played in the approval dialog. External LINE transport was replaced; no message was sent.
- PDF: real document services and Chromium generated asset receipt, expense voucher and other-income receipt PDFs from synthetic data. Each rendered as one A4 page; document numbers, satang totals, Thai text and layout were checked, including rendered page images.
- Read-only independent review: all six findings addressed, including concurrent approval, complete message review, MIME metadata, ALL audience wording, cancellation failure and token-lookup failure. Regression tests cover the two final error cases.

**Final `LOCAL_PREVIEW_PORT=5207 npm run local:check`: PASS**, completed 2026-10-03 at 17:20 Asia/Bangkok. API/Web types, lint, all frontend/shared tests, storefront/web builds and desktop (1440px)/mobile (390px) synthetic browser flows passed. Existing lint and bundle-size warnings remain; no blocking errors. The dedicated Broadcast browser integration also passed against the refreshed preview, including decoded MP4 frames. The managed preview remains running from this checkout.

Verified source fingerprint: `870e438008dee18d0ea21d30f5c94bf258383d829b48d855ad1aafb54a6ef255`.

## Coverage boundaries and local evidence

The managed preview uses synthetic data and supports the documented Inbox/customer/credit/dashboard/FINANCE/trade-in subset. Its Broadcast backend is not the full feature backend; the dedicated browser integration above started an ephemeral real Broadcast API against an isolated database. Real LINE delivery, cloud credentials/CDN access, payment gateways and Giphy availability remain unverified.

- Managed preview: <http://localhost:5207/inbox>.
- Full check result/log: `.tmp/local-preview/check.json`, `.tmp/local-preview/checks.log`.
- Isolated API/browser log: `.tmp/followup-isolated-api.log`.
- Final decoded-video browser check: `.tmp/followup-browser.log`.
- Approval screenshot: `.tmp/local-preview/broadcast-video-approval.png`.
- PDF evidence: `.tmp/followup-pdf.log`, `.tmp/followup-pdf/` (PDFs, rendered PNGs, extracted text).
- Temporary reproduction scripts: `.tmp/test-followup-api.sh`, `.tmp/check-broadcast-integration.cjs`, `.tmp/render-followup-documents.cjs`. Permanent regression tests live beside the changed modules.
