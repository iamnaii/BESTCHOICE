# Upload client simplification — 2026-10-03

Continues the [Broadcast follow-up](2026-10-03-broadcast-followup.md). Changes are local in `/Users/iamnaii/Desktop/App/BESTCHOICE`; no deployment or external message.

## Problem and change

The admin API client's forced `Content-Type: application/json` made Axios serialize FormData as JSON. Tests through the real `otherIncomeApi.uploadAttachment` and `equityApi.uploadAttachment` wrappers reproduced a body of `{"file":{}}`, losing the file before transport.

Removed that default. Axios still serializes ordinary objects as JSON, while browsers send FormData with their generated multipart boundary. This also removes 15 manual header overrides from 14 source files: Broadcast, Inbox/credit/finance application, Todos, AI import, rich menu, canned-response image, after-sales, early payoff, INTER-CO slip and daily cash uploads. Existing endpoints, field names, timeouts, validation and authentication remain unchanged. No new helper or API was introduced.

Regression tests exercise actual Axios transformations through public clients, including JSON POST/PUT/PATCH, the two previously broken upload wrappers, LIFF/staff credential separation, and a file retry after token refresh while the selected company changes. Existing UI tests still assert the submitted file/fields and the 120-second credit-upload timeout; they no longer require a redundant header override.

## Verification

- Reproduction before the fix: both real attachment wrappers failed their FormData assertions with `{"file":{}}`. They pass after the fix.
- Focused tests: 35 tests across 5 files passed.
- Browser transport: 17 actual HTTP requests from this checkout's Vite-transformed API clients to a local Express/Multer fixture. Staff and LIFF JSON/multipart POST, PUT and PATCH, other-income/equity wrappers, and 401 refresh/retry passed. Checked binary file bytes, filename, MIME, Thai text, repeated fields, multipart boundary, JSON body, auth headers and company scope. This uses synthetic credentials and a local HTTP fixture; it does not test business posting or write application data.
- Feature browser checks passed: Broadcast video + cover upload, playable approval preview, and second-user approval through real Nest/StorageService/Prisma against isolated PostgreSQL and local HTTPS storage, with LINE transport captured. Inbox statement upload → synthetic analysis → customer linking → refreshed credit history also passed without page errors. No external messages were sent.
- Read-only independent review: no blockers. All removed overrides belonged to FormData calls; review found no valid raw-string mutation caller relying on the old default. `git diff --check` passed.

**Final `LOCAL_PREVIEW_PORT=5207 npm run local:check`: PASS**, completed 2026-10-03 at 17:49 Asia/Bangkok. API/Web types, lint, builds and desktop/mobile synthetic browser flows passed. Full suites: **2,731 admin-web tests (366 files), 128 shared tests (11 files), 32 storefront tests (7 files): 2,891 tests total**. The API regression counts in the previous report were not rerun or included in this round's total; this round changes frontend request handling only. Existing lint/bundle warnings remain without blocking errors.

The managed preview was refreshed and remains running. The 17-request browser transport check also passed against the refreshed server. Verified source fingerprint: `1071edd173012cba77e7f2167afbc288bd053f7074cd106b8ab9ae0f755d4589`.

## Local evidence

- Preview: <http://localhost:5207/inbox> (synthetic backend with the documented limited feature scope).
- Full result/log: `.tmp/local-preview/check.json`, `.tmp/local-preview/checks.log`.
- Regression logs: `.tmp/upload-payload-red.log`, `.tmp/upload-payload-green.log`, `.tmp/upload-focused.log`.
- Browser transport script/log: `.tmp/check-upload-client.mjs`, `.tmp/upload-browser.log`.
- Feature browser logs: `.tmp/upload-broadcast-browser.log`, `.tmp/upload-inbox-browser.log`.
- Pre-cleanup source snapshots: `.tmp/upload-cleanup-before.json`.
