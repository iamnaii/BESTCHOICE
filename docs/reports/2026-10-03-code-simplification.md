# BESTCHOICE code simplification — 2026-10-03

Scope: simplify existing code across the monorepo while retaining business rules, financial transactions and public interfaces. Changes are local in this checkout; no merge or deployment.

Follow-up: the video-upload, Customer360 and integration gaps listed below were subsequently addressed in [Broadcast and integration follow-up](2026-10-03-broadcast-followup.md). The figures and fingerprint in this report describe the earlier simplification checkpoint.

## Changes

- **Inbox:** share customer/credit query keys and cache invalidation; extract chat media UI and its state hook; retain picker state in the parent through popup and note-mode transitions. Fetch Customer360 risk, notes and channel data only when those sections use it. Share contract-row loading while keeping contact-log and MDM dialog state independent.
- **Broadcast:** separate message model/Flex payload generation, editors and previews from the page. Reuse image/rich upload handling and one multipart upload helper. Browser verification exposed two existing upload defects, fixed here: the API client's JSON header converted FormData to JSON, and late FileReader callbacks erased completed uploads. Successful uploads now preserve both the server URL and visible preview for image/rich/thumbnail.
- **API/shared:** one Thai national-ID checksum used by frontend validation, API validation, customer writes and OCR; one notification-variable parser for UI and API; one LINE payload builder used by SHOP and FINANCE adapters while preserving their distinct delivery rules.
- **Documents:** reuse Bangkok date/document-number layouts, money/address/HTML formatting, existing Thai-baht spelling and attachment magic-byte checks. Counter allocation, advisory locks, formats, rounding and MIME signatures are unchanged.
- **INTER-CO:** move pure journal-line construction into `interco-journal-lines.ts`; preserve Decimal arithmetic, account mappings, legacy fallback, deduction-only behavior, zero-bank omission and transactional posting boundaries.
- **Storefront:** share the saving-plan status badge between list and detail, preserving all four statuses and sizes.
- **Cleanup:** remove unused `useStatusBadge` and its tests after checking production consumers; share WebSocket URL normalization without combining authentication or reconnection logic.

The AST duplicate scan covered all production TypeScript/TSX under API, admin web, storefront, card reader and shared (2,827 files before extraction; 2,840 afterward). Exact function-body groups of at least 80 tokens decreased from 28 to 13. This measures one form of duplication, not all technical debt. Remaining groups include app-owned UI primitives, small JSX callbacks, seeds and transaction-specific mappings; merging these would often add coupling without making the call sites clearer. No card-reader protocol change was warranted.

Across 58 source/test files, the net change is 286 fewer lines, including new files and tests; production code is 453 lines smaller. The large entry files now focus on their main responsibilities:

| File | Before | After |
| --- | ---: | ---: |
| BroadcastPage.tsx | 1,673 | 791 |
| ChatPanel.tsx | 1,351 | 1,069 |
| interco-settlement.service.ts | 2,042 | 1,817 |

## Verification

- Isolated PostgreSQL harness: **602 API unit/regression tests across 35 suites**, plus **119 INTER-CO and contract-exchange integration tests across 5 files**. Both SHOP and FINANCE migrations run against a temporary isolated database; no inherited application database is used.
- Original-versus-extracted comparison: **4,249 cases passed** for document formatting, national-ID checksum and document-number layouts.
- Full frontend/shared suites: **2,712 admin-web tests (364 files), 128 shared tests (11 files), and 32 storefront tests (7 files)** passed. Together with targeted API/integration coverage, this is **3,593 tests**; focused reruns are included in these totals.
- Focused editor tests: **11 passed**, including three upload-completes-before-FileReader regression cases, invalid files, pending/error state, and media picker state.
- Read-only independent review: passed. Preserved financial/numbering rationale was restored alongside moved helpers; the review's preview-loss finding was fixed and verified with rendered-image assertions.
- Browser, same checkout: Broadcast text/image/rich editors, actual multipart request shape, visible previews, confirmation and captured request payload passed. Broadcast API calls were intercepted with synthetic responses; no external broadcast was sent.
- Browser, isolated Inbox preview: emoji insertion, GIF search retained across note-mode transitions, statement attachment → mock analysis → link existing customer → refreshed credit history passed with no page errors. Giphy responses were mocked.
- Browser, storefront Vite app: all four saving-plan statuses rendered correctly on list/detail; existing payment-button eligibility remained correct. API responses were mocked; no payment was initiated.

**Final `LOCAL_PREVIEW_PORT=5207 npm run local:check`: PASS**, completed 2026-10-03 at 16:48 Asia/Bangkok. API/Web types, lint, all frontend/shared tests, storefront/web builds and desktop (1440px)/mobile (390px) synthetic browser flows passed. The preview was refreshed from this checkout and remains running. Broadcast, Inbox media/credit and storefront browser checks were rerun afterward and passed. Existing lint warnings and bundle-size warnings remain; there are no blocking errors.

Verified source fingerprint: `391cb8cc416ed64aefe0d111274af76bee38424a8677cda9de3b2300d217c89f`.

## Coverage boundaries

The managed preview covers synthetic Inbox/customer/credit/dashboard/FINANCE/trade-in flows, not the entire production backend. LINE delivery, external storage, Giphy service availability, PDF visual layout and real payment gateways were not exercised end-to-end. The broad API regression suite is targeted to changed modules, not every API test in the repository.

Customer360 query tests cover hidden/visible sections at initial render; changing `sections`/`bare` on an already-mounted panel and MDM dialog error/null-row paths were reviewed but not directly tested. Broadcast video delivery remains outside this change: its existing upload route validates images, so the current video-file path requires a separate product/API decision. Thumbnail handling is covered by timing tests.

## Local evidence

- Managed admin preview: <http://localhost:5207/inbox>.
- Full check result: `.tmp/local-preview/check.json`; log: `.tmp/local-preview/checks.log`.
- API evidence: `.tmp/simplify-api-tests.log`.
- Browser screenshots: `.tmp/local-preview/simplify-broadcast.png`, `simplify-saving-plans.png`, `inbox-simplify-credit-link.png`.
- Temporary reproduction scripts and original snapshots remain under `.tmp/`; permanent regression tests are next to the changed modules.
