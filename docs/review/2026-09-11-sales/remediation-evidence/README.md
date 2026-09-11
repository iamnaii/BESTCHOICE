# Six-menu UI regression evidence

11 September 2026. Real checkout React pages, synthetic API fixtures at `http://localhost:5207`; no application database or outbound monetary/message calls. The test config restricts the target to loopback, supplies a synthetic principal, and rejects every unsupported API read/write. PDF bytes are a transport fixture, not a real contract document.

Command: `npm run test:e2e --workspace=apps/web -- --config=playwright.sales.config.ts`

Result: **18 tests passed**, 58.1 seconds, finished `2026-09-11T05:53:17Z`. The tested source is committed in `50a21b5d5`, `eb7000344`, and `b86687bd2`. Both 1440×1000 and 390×844 run the same nine scenarios. Images are captured after modal bounds settle; animations are disabled during capture.

| Scenario | Assertions / capture |
|---|---|
| Customer list | page2, tier+sort, all201 XLSX rows and matching request filters; mobile filter focus return; `customers-filtered-page2-*` |
| Customer detail | SALES can start credit/upload but cannot edit master; all7 tabs stay within page; `customer-detail-0-*` through `customer-detail-6-*` |
| Credit queue | record51, null score, pending filter continuity, error/search focus, retry→empty; `credit-error-filters-retained-*` |
| POS | cash9000/external10000, actual customer/product selection, handoff disclosure and restored wizard IDs; `pos-handoff-review-*` |
| Bookings | size200 shows151 records, page2 detail, PAID restricted actions; `bookings-page2-paid-*` |
| Contracts | guardian4/5, filtered all201 export and current-page50 export, Kanban page3 scoped counts; `contracts-kanban-page3-*` |
| Sales | all201 export preserves every selected filter, sale detail link, null vs0 receipt, keyboard focus return, void last row→valid page; `sales-detail-deep-link-*` |
| Export cancellation | hold page2, switch SHOP→FINANCE in sidebar, await actionable cancellation message, no download |
| Role/PDF | FINANCE_MANAGER cannot create/sign; ACTIVE+APPROVED downloads the intercepted PDF; `contracts-finance-read-actions-*` |

All scenarios reject uncaught page errors. Screenshots also assert page horizontal overflow is absent; modals must fit the viewport. Additional price/signing, booking lifecycle and quote/signature states live in `../evidence/core`, `../evidence/bookings`, and `../evidence/contracts`; those scripts passed8/20/10 states respectively on this checkout. API/ledger assertions use the separate disposable PostgreSQL harness; see [verification report](../remediation-verification.md).
