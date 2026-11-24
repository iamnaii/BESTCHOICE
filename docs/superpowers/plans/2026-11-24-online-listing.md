# Simplified online listing Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline; perform a fresh whole-change review at completion.

**Goal:** Remove grade gating and use recorded six-angle photos automatically with a simpler listing UI.
**Architecture:** Shared gallery projection loads only active angle presence and returns gated public image URLs; existing legacy gallery remains fallback. Nullable cover angle stores selection. Readiness, catalog, chat and admin consume the same projection.
**Tech Stack:** NestJS, Prisma/PostgreSQL, React, Tailwind.
**Spec:** docs/superpowers/specs/2026-11-24-online-listing-design.md

## Global Constraints
Preserve permissions, tenant scope, existing manual galleries, hidden/deleted handling and staff evidence privacy. No deployment. Verify this checkout with local:check and feature browser/API checks.

## Review Focus
- Missing/null grades remain visible; no unknown grade UI.
- Existing angle-only products, replacement and deletion reflect immediately.
- No evidence or hidden product image can be fetched through public image route.
- Catalog requests do not load six base64 blobs per product.
- Cover persistence and failures do not discard unrelated unsaved form edits.

### Task 1: Eligibility and derived gallery
Files: product-readiness.util.ts/spec.ts; new product-listing-gallery.util.ts/spec.ts; schema.prisma + additive migration; products.service.ts; products-online-listing.service.ts/dto; shop-catalog.service/controller; chat-commerce.service.ts.
Interface: hydrateListingGalleries(client, products) returns products with effective gallery; public angle URL serves eligible products only.
- [x] Add failing tests for null grade, six-angle gallery projection, cover order and evidence/hidden rejection.
- [x] Implement shared eligibility/gallery and wire all consumers, cover save and image delivery.
- [x] Run targeted API tests and real isolated PostgreSQL integration covering existing angle-only stock and replacement/deletion.

### Task 2: Listing UI and shop display
Files: OnlineListingPanel.tsx, ReadinessCard.tsx, ProductWarrantyForm.tsx, ProductDetailPage/index.tsx, web-shop ProductDetailPage.tsx; associated tests.
- [x] Add tests for automatic photos/cover and hidden unknown grade.
- [x] Implement compact layout and immediate-action copy; preserve manual gallery fallback and edit permissions.
- [x] Run affected UI tests and type checks.

### Task 3: Verify and review
- [x] Run npm run local:check, feature browser checks on desktop/mobile, leave preview running (full-check failure recorded below).
- [x] Fresh review; resolve consequential findings and rerun affected checks.
- [x] Record verification and deliver local URL plus limitations.

## Execution ledger
Ruling: continue in the existing feature checkout to preserve the user's configured preview; no main/master edits. User's approval authorizes implementation; execute inline without another method-selection round.

Ruling: preserve the separate pre-existing sales-bot QC suggestion rules; the user removed the shop publication grade gate, not the independent bot inventory recommendation policy. Public photo projection is shared without broadening those searches.

Task 1/2 complete: initial missing-gallery tests and automatic-photo UI tests failed before implementation; API focused suite 216 passed, post-review compatibility/QC suites 82 passed; actual disposable PostgreSQL + browser desktop/mobile checks passed. Independent review corrections: no QC/legacy-ANGLE copies, action permissions, MIME signature validation, batch metadata, gated image URLs for unfiltered consumers. Full local:check in progress.

Final feature verification: four affected API suites / 87 tests passed after ANGLE compatibility and bot-scope fixes. Disposable PostgreSQL integration passed against the refreshed backend; corrected the fixture MIME to PNG (historical .jpg file contains PNG bytes). Admin browser checks passed at 1440px and 390px in light and dark themes; customer product gallery passed with six real image responses and no unknown-grade badge. Peripheral storefront config/tracking/related endpoints are simulated, quote uses the isolated service result (no configured rates). First full local check passed all types/lint/unit/build steps but hit an unrelated Inbox focus-ring assertion; the identical Inbox filter check passed separately. Full check rerun finished: types, lint, web/shared/storefront tests, storefront focus/motion tests and both builds passed. Inbox focus/search/layout now passed. The full command remains FAILED at tools/check-local-chat-sales.mjs:57: a newly created chat-sales task was absent from the generic todo list. This is outside the listing change; do not claim a fully green local:check. Subsequent generic checks did not run. No unrelated chat implementation or test was modified.

Handoff: managed preview is running/current at http://localhost:5218/products/preview-online-listing-phone?zone=shop (select ขึ้นเว็บ), source fingerprint 652520b9d7cf4726570222015c74ff49a911387f1e8686d3682e384cf1fb34e7. Real API + six-angle browser checks rerun against this refreshed backend; synthetic fixture only. No production deployment or data mutation. Existing unrelated branch-manager audit file preserved.

Follow-up copy clarification: renamed description field to “รายละเอียดเพิ่มเติมให้ลูกค้าเห็น (ไม่จำเป็นต้องกรอก)” and added examples in its placeholder. Verified accessible textbox label on mobile. Full npm run local:check now PASS, including all browser flows (the prior intermittent Inbox/chat-task assertions passed this run). Preview remains running with synthetic data at localhost:5218.

Warranty follow-up (owner approved): reuse the six clauses already approved in packages/shared/src/sale-receipt.ts. Project standard terms for covered products when per-device terms are empty; preserve custom terms. Read the same shop setting as product entry/receipts. Admin detail exposes standard duration/text separately; listing form shows the standard automatically, follows duration edits, offers reset from custom, and saves null to inherit rather than creating copies. Zero/no shop warranty does not gain standard coverage. API focused suites 126 passed; form 7 passed; shared 3 passed. Actual isolated PostgreSQL verifies admin/customer terms agree, duration and all six clauses without a per-device copy. Form browser 1440/390 passed on refreshed backend; customer browser verifies all six clauses and duration at both sizes. Real isolated HTTP save/reset test verifies custom terms persist, null restores inherited terms, day changes substitute correctly for inherited terms, and zero days removes default coverage; synthetic fixture restored. Peripheral storefront config/tracking/related remain simulated. Full local:check completed with types, lint, web/shared/storefront tests and both builds PASS, but FAILED in the pre-existing chat-sales generic task lookup assertion at mobile width (tools/check-local-chat-sales.mjs:57). This previously intermittent assertion is outside the warranty change; subsequent generic checks did not run. Feature-specific warranty tests and fresh admin/customer browser/API checks all passed. No unrelated chat implementation/test was changed. Managed preview remains running/current; no deployment or production writes.

Integrated product information follow-up: owner requested merging the listing page into ข้อมูลสินค้า. Remove the separate ขึ้นเว็บ tab; compose identity, prices, availability/readiness, calculator, compact six-angle cover controls, public description and warranty in the default information view. Keep photo capture in รูปถ่าย. Suppress the identity card’s duplicate six-photo strip and the price card’s duplicate readiness row. Preserve role guards, sold-contract/calculator behavior, cost access and legacy gallery. Do not show six-angle guidance for accessories. Initial composition/duplicate-strip tests failed before implementation. Desktop 1440, tablet 1024, mobile 390 browser checks pass default-page content, six photos, persisted cover selection, photos round trip and no overflow/page errors. Focused component tests 16/16 passed; dark-mode and integrated warranty browser checks also pass. First full check exposed three source-marker-based tab tests after the comment was renamed; restored their stable marker while keeping the new accurate comment. Tab regression 55/55 now passes; full local:check rerun PASS, including complete desktop/mobile browser flows. Managed preview verified current and running. Final fresh-browser check confirms the default merged page, no separate listing tab, and actual visibility toggle save/restore on the synthetic fixture. No deployment or production data changes.
