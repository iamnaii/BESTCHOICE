# Noto Sans Thai Looped and readable minimal UI

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. The user requested planning followed by implementation; execution is native in the existing isolated worktree, with the repository's independent read-only review before handoff.

**Goal:** Use Noto Sans Thai Looped throughout application UI, preserve document typography, and reduce the amount of explanatory text users must read before doing their work.

**Architecture:** Reuse the admin and storefront font tokens, serve licensed font files locally, and explicitly isolate document fonts. Shorten copy at its source and use opt-in accessible disclosure for supplemental instructions; never automatically hide text based on length or apply blanket truncation.

**Tech Stack:** React, TypeScript, Vite, Tailwind, existing Radix primitives, Vitest and Playwright.

**Spec:** User request in this conversation, 2026-10-14: “ปรับให้ใช้ NOTO SANS THAI LOOPED ทั้งโปรแกรม ยกเว้น พวกเอกสาร … ดูสแกล … บางหน้า ข้อความมันเยอะเกิน … mininal วางแผนก่อนแล้วค่อยแก้ไข … uxuipromax”.

## Global constraints

- Cover admin, auth/public pages, LIFF/customer screens and the storefront. Existing brand image artwork is not text UI.
- Keep receipts, contracts, vouchers, PDFs, labels/stickers, template paper and print typography unchanged. Preserve document font assets and metrics.
- Keep financial amounts, payment conditions, deadlines, validation errors, security warnings and destructive-action consequences visible and complete.
- Preserve API contracts, calculations, permissions, business flows, company selection, labels required to identify controls and navigation destinations.
- Retain BESTCHOICE semantic Zinc/Emerald light/dark colors. No new palette, motion library or UI framework.
- Use Noto Sans Thai Looped normal widths; body 400, normal actions 500, headings 600. Preserve exceptional emphasis when meaningful.
- Main admin headings 22px mobile / 24px desktop; section headings 16–18px; body/table text 14–16px; supporting text at least 12px; mobile inputs at least 16px; Thai line-height 1.5–1.65.
- Minimal means fewer competing explanations, not smaller text or inaccessible icon-only controls.
- Local preview uses synthetic data/AI. No staging/physical devices are available; do not claim native LINE/OAuth/keyboard/camera/printer validation.

## Evidence and design rationale

- Base: main `c26cf0091`; the previous audit's tests passed and its managed preview remains available.
- Source inventory: `.tmp/noto-minimal/copy-inventory.json`, 281 source files with long static text or descriptions. This is a prioritization aid, not 281 confirmed UX defects.
- UI UX Pro Max `minimal business application --domain style`: Minimalism & Swiss Style, clear hierarchy, restrained decoration, contrast and keyboard focus.
- UI UX Pro Max `Thai text line height --domain ux`: 1.5–1.75 line-height, natural wrapping and real-content testing.
- Its generic dashboard design-system recommendation suggested Fira/blue marketing sections, which do not fit this request; those recommendations are rejected. The user's Noto choice and the existing palette take precedence.
- Search for progressive disclosure did not yield an applicable rule after a narrowed retry. The disclosure decision is a project-specific design choice, grounded in existing SummaryCardHelp and the user's request, not a verified database recommendation.

## Review focus

1. Actual font loading rather than a matching CSS family with a missing font; verify Thai, Latin, numerals and weights after fonts.ready.
2. Paper boundaries: compare descendant typography and geometry with old and new UI fonts in screen and print media.
3. Thai stacked marks, long customer names, large amounts and mixed Latin/Thai labels: verify 320/390/768/1056/1440 widths and enlarged text.
4. Disclosures remain keyboard/touch operable and preserve details; financial/security consequences stay visible outside them.
5. Public/LIFF screens, portal menus and notifications use the same UI font; storefront fixtures never proxy live production.

## Task 1 — Local font assets and document isolation

**Files:** `apps/web/src/index.css`, new `apps/web/src/styles/fonts.css`, `apps/web/index.html`, `apps/web/public/fonts/noto-sans-thai-looped/`, `apps/web-shop/src/styles/fonts.css`, `apps/web-shop/src/styles/tokens.css`, `apps/web-shop/src/index.css`, `apps/web-shop/index.html`, `apps/web-shop/public/fonts/noto-sans-thai-looped/`.

- [x] Capture baseline receipt/template/sticker font metrics from the running preview.
- [x] Download official Google Fonts WOFF2 subsets and OFL; record source URLs, family and weight ranges. Preload only normal Thai text; retain existing document font assets.
- [x] Define `--font-sans: 'Noto Sans Thai Looped', system-ui, sans-serif` for UI and keep legacy document font tokens explicit at paper boundaries.
- [x] Update body, boot/loading text, UI code/identifier text, portals/toasts and storefront heading aliases; retain paper, rich-text document/editor and sticker overrides.
- [x] Verify loaded fonts and unchanged document metrics; inspect both themes at mobile/desktop sizes.

## Task 2 — Scale and reusable supplemental help

**Files:** `apps/web/src/styles/admin-typography.css`, `apps/web/src/components/ui/PageHeader.tsx`, a focused `InlineHelp.tsx` if existing primitives do not cover inline disclosure, component tests, `tools/check-admin-typography.mjs` and a focused Noto/browser verifier.

- [x] Retain 22/24px main headings and existing 14px dense tables; keep mobile form controls at least 16px.
- [x] Test native disclosure open/close via keyboard and pointer, accessible summary, and complete original details.
- [x] Add an optional `help`/`helpLabel` prop to PageHeader; existing subtitles remain visible unless individually rewritten.
- [x] Use natural line wrapping with bounded explanatory widths, adequate Thai line-height and minimum touch targets. Do not introduce a global fixed height or line clamp for essential text.
- [x] Reuse existing SummaryCardHelp for summary-card formulas; use inline expansion for longer instructions where a popover is too small.

## Task 3 — Reduce repetitive explanations at their source

**Files:** selected existing pages/components identified in the inventory: RepossessionsPage, QcCenterPage, AccountRolesPage, StickerPrintPage, PeakExportPage, AssetsListPage, OtherIncomeListPage, AiSettingsPage, IntegrationHubPage, OffsiteBackupTab, PdpaTab, RoomDossier, BookingEmptyState and other verified repetitive static subtitles.

- [x] Keep each page purpose in one short sentence. Example: repossessions subtitle becomes “บันทึกรับเครื่องคืนและติดตามการยืนยัน”; role/process instructions remain in “ขั้นตอนรับเครื่องคืน”.
- [x] QC summary retains “ถ่ายรูปมือถือมือสองให้ครบ 6 มุมก่อนขึ้นขาย”; sources/exemptions move into help, while rejection consequences remain in the action dialog.
- [x] Rewrite technical account-role text into user language; keep immediate accounting effects and deactivation failures visible.
- [x] AI/integration settings expose actions and status first; move background mechanics to concise help and remove implementation jargon from ordinary product flows.
- [x] Condense repeated customer-linking explanations in the dossier without hiding missing-link status or next actions.
- [x] Reduce booking empty-state introduction, keeping expiry, forfeiture and refund conditions visible.
- [x] Privacy/legal policies and transaction confirmations keep their substantive wording. Review flagged long text rather than removing it automatically.
- [x] Record changed copy and retained critical information in the implementation report; update affected label assertions only when user-facing copy intentionally changes.

## Task 4 — Verification and handoff

**Files:** existing browser/unit suites, `docs/guides/admin-typography.md`, `docs/guides/storefront-typography.md`, new review report under `docs/review/2026-10-14-noto-minimal/`.

- [x] Run affected component tests and browser disclosure/font checks, including light/dark, long values and enlarged text.
- [x] Run `npm run local:check` after the final source edit; leave this worktree's verified managed preview running.
- [x] Run admin typography/paper isolation checks and the existing full 269-route inventory at 320/390/1440 (both themes), with isolated PostgreSQL fixtures.
- [x] Run LIFF browser coverage and storefront route/font/layout checks against local synthetic fixtures.
- [x] Request the repository's independent read-only code review; fix substantive findings and rerun affected checks.
- [x] Update the guides and final report with exact coverage, failures/limitations and preview URLs. Do not automatically merge or deploy this new design change.
