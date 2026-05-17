# A1 · Settings Audit Phase 1+2+4 (Scan + Report + Implement)

**Status:** ✅ Phase 1+2+4 complete — 102/102 items shipped (pending merge of 86 PRs from 2026-05-17 session)
**Started:** 2026-05-16  ·  **PRs:** [#879](https://github.com/iamnaii/BESTCHOICE/pull/879) (Phase 1) · Phase 2 companion · D1 #882-#897 + 2026-05-17 86-PR session (Phase 4)
**Spec:** [`../specs/2026-05-16-a1-phase2-decision-report.md`](../specs/2026-05-16-a1-phase2-decision-report.md)  ·  **Plan:** D1 PRs (one per item)

> ✅ **Phase 4 implementation 100% complete (pending merge).** All 102 audit items — including SKIP-sub-sections (3.4 / 4.1 / 4.2 / 4.3.2–4.3.6) reopened per owner directive — closed via 86 parallel PRs on 2026-05-17. Row-level details remain in `D1-settings-implement.md`.

## Context

Read-only scan of the codebase against the 102 settings owner enumerated in `Settings_Audit_Core_v2.0`. Each item is marked ✅ Exists / ❌ Missing / ◐ Partial with a `file:line` evidence pointer. Phase 2 produces a markdown summary table. **Hard stop** at end of Phase 1 — owner reviews before Phase 2 synthesis. **Hard stop again** at end of Phase 2 — owner approves which items go into D1 (Phase 4 Implement) before any code change happens.

## Source

- [Settings Audit Core v2.0](_owner-package/Settings_Audit_Core_v2.0.md) — 102 items with Detection Hints
- [Settings Audit Index](_owner-package/Settings_Audit_Index.md)
- [Settings Audit Change Log](_owner-package/Settings_Audit_Change_Log.md)

## Phase

✅ **Phase 1: AUDIT** (#879) → ✅ **Phase 2: REPORT** ([spec](../specs/2026-05-16-a1-phase2-decision-report.md)) → ✅ **Owner approved expanded scope** (2026-05-16) → 🟢 **D1 (Phase 4: IMPLEMENT) IN PROGRESS** — one PR per item per anti-pattern #3.

## Phase 1 Headline (audit-only, NOT a recommendation)

**102 items audited · 6 parallel Explore agents · Opus model.**

| Tier | Total | ✅ Exists | ◐ Partial | ❌ Missing |
|---|---|---|---|---|
| P0 (sec 1.1–1.6) | 30 | 7 | 11 | 11 |
| P1 (sec 2.1–2.8) | 37 | 2 | 3 | 32 |
| P2 (sec 3.1–3.6) | 20 | 0 | 1 | 19 |
| P3 (sec 4.1–4.3) | 15 | 3 | 3 | 9 |
| **TOTAL** | **102** | **12 (12%)** | **18 (18%)** | **71 (69%)** |

(Plus 1 SKIP — A1.1.3.4 SSO max, deferred to section 1.4 per spec.)

(Counts post-R2: row-level icons are the source of truth. R2A recount fixed the Phase-1 headline undercount; R2B found 3 more false negatives — A1.1.6.1 + A1.1.6.2 (adjustment routes are seeded in account_role_map but consumers hardcode literals — "dead config" pattern) and A1.2.3.6 (User.preferences JSON exists with live endpoint, just not wired to display settings yet). Net: ✅ 11→12, ◐ 16→18, ❌ 74→71.)

This is a raw scan result, not a scope decision. Phase 2 synthesizes it into a per-sub-section verdict ✅ APPROVE / ◐ DEFER / ⏸ SKIP after owner confirms the audit findings.

## Decision Framework (for Phase 2 — owner reviews after this PR)

After Phase 2 produces results, owner decides per sub-section:
- ✅ APPROVE: P0 ≥ 80% missing + P1 ≥ 50% missing → implement
- ◐ DEFER: P0 ≥ 50% missing but P1 < 50% → P0 only this sprint
- ⏸ SKIP: P0 < 50% missing → system already covers

**Tie-breaker (codified by R2 review):** when computing "missing %", **◐ Partial counts toward Missing**. Every Partial in this audit is one of (a) "consumer doesn't read the configured value" (e.g. A1.1.6.1/2 dead config) or (b) "UI offers subset of spec range" (e.g. A1.1.3.2 WHT rates) or (c) "value exists but in code, not OWNER-editable" (e.g. A1.1.3.5 effective_date support). All three require D1 implementation work, so a Partial is not "already covered". Owner can override this rule per sub-section in Phase 2 if a Partial actually IS sufficient.

## Items Checklist

> **102 items total.** Numbering preserves owner's source format: `A1.<section>.<subsection>.<item>` maps to Settings Audit Core `<section>.<subsection>` heading. Status legend: ✅ Exists (runtime-configurable by OWNER) · ◐ Partial · ❌ Missing.

### 1.1 Account Role Map (7 items · P0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.1.1.1 | DB table: `account_role_map` | P0 | ✅ | this PR | `apps/api/prisma/schema.prisma:3680` (`model AccountRoleMap` → `@@map("account_role_map")`); migration `20260919000000_add_account_role_map`. Full schema with role/accountCode/priority/isActive/note |
| A1.1.1.2 | `GET /api/settings/role-map` | P0 | ❌ | this PR | No route. SettingsController exposes only `GET /` + `GET /collections`. `AccountRoleService.list()` exists but no controller wraps it |
| A1.1.1.3 | `PUT /api/settings/role-map` | P0 | ❌ | this PR | No mutation endpoint. Service has `invalidate()` but no write path |
| A1.1.1.4 | Admin UI for role map | P0 | ❌ | this PR | No web page references `AccountRoleMap`/`role-map` under `apps/web/src/`. Backend hint exists, UI never built |
| A1.1.1.5 | Validation rules | P0 | ❌ | this PR | No DTOs for role-map writes. Boot-time validation at `account-role.service.ts:38-45` only |
| A1.1.1.6 | Audit log on change | P0 | ❌ | this PR | No mutation path to audit; AuditService not invoked from `account-role.service.ts` |
| A1.1.1.7 | Permission control (Admin only) | P0 | ◐ | this PR | `apps/api/src/modules/settings/settings.controller.ts:14-15` has `@UseGuards(JwtAuthGuard, RolesGuard) @Roles('OWNER')` on whole controller — would inherit if role-map routes were added |

### 1.2 Document Numbering (5 items · P0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.1.2.1 | `doc_prefix_per_type` (EXP/SET/PAY/CN/PC) | P0 | ◐ | this PR | `apps/api/src/modules/expense-documents/services/doc-number.service.ts:4-10` hardcoded `PREFIX_MAP` (EX/CN/PR/SE/PC). Spec said EXP/SET/PAY/CN/PC; code uses EX/SE/PR/CN/PC — different abbreviations. Not config-driven |
| A1.1.2.2 | `doc_number_format` (YYMMNNN) | P0 | ◐ | this PR | `doc-number.service.ts:18` format `<TYPE>-YYYYMMDD-NNNN` (daily reset, 13 chars). Spec wanted `YYMMNNN` (monthly reset, 7 chars). **Format itself AND reset cycle differ from spec** — would require breaking change to align. Not configurable |
| A1.1.2.3 | `reset_cycle` (yearly) | P0 | ❌ | this PR | Cycle is daily (BKK-day key at `doc-number.service.ts:38-40`), not yearly. No `reset_cycle` config |
| A1.1.2.4 | `sequence_table` (doc_sequences) | P0 | ❌ | this PR | No `doc_sequences`/`DocSequence` model. Sequence derived via Postgres advisory lock + `findFirst orderBy desc` (`doc-number.service.ts:41-50`) — lock-based scan, no dedicated table |
| A1.1.2.5 | Admin reset capability | P0 | ❌ | this PR | No admin reset endpoint or CLI; resets implicitly on date rollover |

### 1.3 Tax Rates (6 items · P0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.1.3.1 | `vat_rate` (7%) | P0 | ◐ | this PR | **🚨 R1A surfaced an orphan-key bug**: `SettingsPage/tabs/VatTab.tsx:26,35` UI writes SystemConfig key `VAT_RATE`, but `purchase-orders.service.ts:99` reads a DIFFERENT key `'vat_pct'` — VAT_RATE setting is non-functional through the documented path; consumer always falls back to `0.07` because `vat_pct` is never seeded. Hardcoded `0.07` fallbacks also in repossessions/asset-disposal templates. Also `config.util.ts:126-131` reads from yet another path. **Worth a P0 D1 fix even before Phase 2 verdict** |
| A1.1.3.2 | `wht_rates` (1/3/5/10/15) | P0 | ◐ | this PR | **R1B flipped from ❌ to ◐**: `AssetEntrySection2Cost.tsx:167-170` hardcodes `<SelectItem value="0.01/0.03/0.05">` — only 3 of 5 spec rates (missing 10% and 15%). Schema `wht_rate Decimal` column at `schema.prisma:3109` allows per-line free entry. UI offers limited dropdown but column allows free entry — partially configurable, missing 2 spec rates |
| A1.1.3.3 | `sso_rate` (5%) | P0 | ◐ | this PR | `dto/create-payroll.dto.ts:74,88`; `sso-config.service.ts:55`; `schema.prisma:2205` comment "5% rate is fixed by law and intentionally NOT stored". Enforced via `maxContribution` cap only |
| A1.1.3.4 | `sso_max` (refined → 1.4) | P0 | — | — | SKIP per spec (covered by 1.4) |
| A1.1.3.5 | effective_date support | P0 | ◐ | this PR | `schema.prisma:2214` `effective_from`/`to` on **SsoConfig only**. No `effective_from` on `system_config` (VAT_RATE) or any per-rate tax table |
| A1.1.3.6 | Admin UI | P0 | ◐ | this PR | `apps/web/src/pages/SettingsPage/index.tsx:7-62` has Company/VAT/Periods/Attachment/Users tabs. VAT tab editable (rate + price-type). NO WHT/SSO/general-tax-rates admin UI; no `/settings/tax-rates` route |

### 1.4 SSO Configurable (4 items · P0 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.1.4.1 | `sso_salary_ceiling` (17,500 ฿ default 2569) | P0 | ✅ | this PR (B1 #861) | `schema.prisma:2210` (`salaryCeiling`); migration `20260927000000_sso_config_table/migration.sql:29` seeds 17500 |
| A1.1.4.2 | `sso_max_contribution` (875 ฿ default 2569) | P0 | ✅ | this PR (B1 #861) | `schema.prisma:2212` (`maxContribution`); migration seeds 875 |
| A1.1.4.3 | `sso_effective_from`/`to` | P0 | ✅ | this PR (B1 #861) | `schema.prisma:2214-2216` both columns + composite index for date-range lookup |
| A1.1.4.4 | Stepped ceiling support (2569 → 2572 → 2575) | P0 | ✅ | this PR (B1 #861) | Migration seeds 3 rows (17500/875 2026→2028; 20000/1000 2029→2031; 23000/1150 2032→NULL); `sso-config.service.ts:22-40` does date-based lookup; tests assert |

### 1.5 Petty Cash (5 items · P0 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.1.5.1 | `petty_cash_enabled` (true default) | P0 | ❌ | this PR | `DocTypePicker.tsx:35` DocType statically listed; no flag check. Feature always-on |
| A1.1.5.2 | `petty_cash_account` (11-1103) | P0 | ✅ | this PR | `apps/api/src/modules/expense-documents/services/petty-cash.service.ts:29,39,87` reads `system_config.petty_cash_account` with **`'11-1201'` default (spec says 11-1103 — mismatch)** |
| A1.1.5.3 | `petty_cash_limit` (5,000 ฿) | P0 | ✅ | this PR | `petty-cash.service.ts:30,40` reads `system_config.petty_cash_limit` with `'5000'` default; enforced by V20.1 |
| A1.1.5.4 | `petty_cash_replenish_threshold` (1,000 ฿) | P0 | ◐ | this PR | **🚨 "Dead setting"**: `petty-cash.service.ts:31,42-44` reads the key (`replenishThreshold`) but `petty-cash.service.ts:11` interface comment is explicit "advisory, not enforced". No consumer ever acts on it. Functionally worse than a hardcoded value — gives false confidence of configurability. Spec default `1,000 ฿` never applied even when key is set |
| A1.1.5.5 | `petty_cash_custodian` (employee FK) | P0 | ❌ | this PR | `PettyCashLinesSection.tsx:50-57`; `ExpenseFormV4.tsx:73,241` — `custodianName` is per-doc free text. No FK to employee, no default custodian setting |

### 1.6 Adjustment Routing (3 items · P0 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.1.6.1 | `adj_underpay_account` (52-1104) | P0 | ◐ | this PR | **R2B flipped ❌→◐ — "dead setting" pattern.** Migration `20260919000000_add_account_role_map/migration.sql:46` SEEDS `account_role_map` with `role='adj_underpay'`, `account_code='52-1104'`. Infrastructure (`AccountRoleMap` table + `account-role.service.ts`) exists for runtime lookup. BUT consumers at `payment-receipt-2b.template.ts:249`, `payment-receipt-2b-split.template.ts:212`, `payments.service.ts:1989` still hardcode `'52-1104'` literals — they do NOT call `accountRoleService.getAccountForRole('adj_underpay')`. Configurable in DB but consumers ignore the configured value |
| A1.1.6.2 | `adj_overpay_account` (53-1503) | P0 | ◐ | this PR | **R2B flipped ❌→◐ — same pattern.** Migration seeds `role='adj_overpay'`/`'53-1503'` (line 45). Consumers at `AdjustmentSection.tsx:29`, `payment-receipt-2b.template.ts:277`, `payment-receipt-2b-split.template.ts:204`, `payments.service.ts:1987` hardcode literal. Dead-config — wire-up needed in D1 |
| A1.1.6.3 | `adj_auto_route` (true) | P0 | ❌ | this PR | Unconditional `if (diff > 0) … else …` in `payment-receipt-2b.template.ts:249,277`, `payments.service.ts:1987-1989`. No flag to disable |

### 2.1 Approval Workflow (6 items · P1)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.2.1.1 | `approval_enabled` | P1 | ❌ | this PR | No `APPROVAL_ENABLED` SystemConfig key; `expense-documents.service.ts` never gates on it. "Approval" = optional `approvedById` FK only |
| A1.2.1.2 | `approval_threshold` (50,000 ฿) | P1 | ❌ | this PR | Only `ATTACHMENT_REQUIRED_ABOVE_AMOUNT` exists (`expense-documents.service.ts:1518-1535`); no amount-based approval gate |
| A1.2.1.3 | `approvers_list` (user IDs) | P1 | ◐ | this PR | Hardcoded `APPROVER_ROLES = ['OWNER','FINANCE_MANAGER','ACCOUNTANT']` at `ApproverSection.tsx:16`. Eligible-role set hardcoded client-side |
| A1.2.1.4 | `approval_required_doc_types` ([PAYROLL]) | P1 | ❌ | this PR | No doc-type filter for approval; `expense-documents.service.ts:252` stores `approvedById` unconditionally for all types |
| A1.2.1.5 | `notification_on_pending` (email + in-app) | P1 | ❌ | this PR | No notifier call on document create/submit; no `PENDING_APPROVAL` event emitted |
| A1.2.1.6 | `auto_post_on_approve` (true) | P1 | ❌ | this PR | `enum DocumentStatus { DRAFT ACCRUAL POSTED VOIDED }` (`schema.prisma:3554-3559`) — no `PENDING_APPROVAL`/`APPROVED` state. `approvedById` is a label only |

### 2.2 Voucher Branding (7 items · P1)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.2.2.1 | `company_name` (from profile) | P1 | ❌ | this PR | Hardcoded `<h1>BESTCHOICE FINANCE × SHOP</h1>` at `PaymentVoucherPage.tsx:270,455,624,826`. `CompanyInfo.nameTh` exists (`schema.prisma:2982`) but voucher doesn't read it |
| A1.2.2.2 | `company_address` (from profile) | P1 | ❌ | this PR | Hardcoded "เลขประจำตัวผู้เสียภาษี · สำนักงานใหญ่" at `PaymentVoucherPage.tsx:271-272,456-457,625-626,827`. `CompanyInfo.address` unused |
| A1.2.2.3 | `tax_id` (from profile) | P1 | ❌ | this PR | Same hardcoded placeholder; `CompanyInfo.taxId` at `schema.prisma:2984` not wired |
| A1.2.2.4 | `logo_url` (uploaded) | P1 | ❌ | this PR | No `<img>` tag in `PaymentVoucherPage.tsx`. `CompanyInfo.logoUrl` at `schema.prisma:2992` unused |
| A1.2.2.5 | `theme_color` (#F87171) | P1 | ❌ | this PR | Voucher uses Tailwind `text-primary`/`bg-primary` tokens (`PaymentVoucherPage.tsx:703,920`). Theme = build-time CSS vars, no runtime override |
| A1.2.2.6 | `language` (th) | P1 | ❌ | this PR | Hardcoded `<html lang="th">` at `apps/web/index.html:2`. No i18n framework |
| A1.2.2.7 | `show_qr_code` (true) | P1 | ❌ | this PR | Zero `qr`/`QR` matches in `PaymentVoucherPage.tsx`. Feature absent |

### 2.3 Display Preferences (6 items · P1)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.2.3.1 | `default_time_range` (this_month) | P1 | ❌ | this PR | Presets hardcoded at `DateRangeChips.tsx:19-28` (`thisMonthRange`, `lastMonthRange`); pages pick initial range locally |
| A1.2.3.2 | `pagination_size` (20) | P1 | ❌ | this PR | Hardcoded `limit=200` in `ApproverSection.tsx:25`; no central pagination default. Per-page sizes are page-local literals |
| A1.2.3.3 | `date_format` (DD/MM/YYYY) | P1 | ❌ | this PR | `formatDateShort` hardcoded to BE year `${DD}/${MM}/${YYYY+543}` at `apps/web/src/utils/formatters.ts:24-28`. No toggle |
| A1.2.3.4 | `decimal_places` (2) | P1 | ❌ | this PR | Default arg `decimals = 2` in `formatNumberDecimal` at `formatters.ts:80`. Compile-time default |
| A1.2.3.5 | `thousands_separator` (,) | P1 | ❌ | this PR | `toLocaleString('th-TH', ...)` at `formatters.ts:77,83` — locale hardcoded |
| A1.2.3.6 | `per_user_override` (true) | P1 | ✅ | this PR | **R2B flipped ❌→✅ — false negative.** `schema.prisma:556` has `preferences Json? @map("preferences")` on User model. Live consumer: `auth.service.ts:436-446` (`updatePreferences` merge-patch); endpoint `PATCH /auth/me/preferences`. Frontend `AuthContext.tsx:12,92` + `useViewToggle.ts:18,33` persist per-user UI state. Mechanism exists — display settings (date_format/decimal_places) just aren't wired to read from it yet, but that's a different item |

### 2.4 Templates Management (5 items · P1)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.2.4.1 | `templates_enabled` (true) | P1 | ❌ | this PR | No `TEMPLATES_ENABLED` SystemConfig key; `expense-templates.service.ts` always mounted |
| A1.2.4.2 | `max_templates_per_user` (50) | P1 | ❌ | this PR | `ExpenseTemplate` (`schema.prisma:3854-3874`) has no count guard; no per-user limit check |
| A1.2.4.3 | `sharing_rules` (private) | P1 | ❌ | this PR | `ExpenseTemplate` has only `createdById` + `branchId`; no isPublic/sharedWith/visibility. Branch-scoped implicitly — no per-template ACL |
| A1.2.4.4 | `variables_support` (true) | P1 | ◐ | this PR | `prefilledData Json` at `schema.prisma:3859`; `isRecurring`/`recurringDay` at 3860-3861. JSON freeform; no formal variable interpolation/placeholder syntax |
| A1.2.4.5 | `categories` (list) | P1 | ❌ | this PR | Category stored as CoA code string in `prefilledData.category` (`expense-templates.service.ts:132`). No `TemplateCategory` table |

### 2.5 Voucher Print Modes (3 items · P1 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.2.5.1 | `voucher_print_mode_default` (single) | P1 | ❌ | this PR | `PaymentVoucherPage.tsx:194-237` — branches by documentType only; no "single vs multi" mode toggle |
| A1.2.5.2 | `voucher_include_adjustment` (false) | P1 | ❌ | this PR | `PaymentVoucherPage.tsx:60-113` VoucherDoc interface — no `adjustments` field. Adjustment rows never rendered in print |
| A1.2.5.3 | `voucher_show_partial_columns` (true) | P1 | ❌ | this PR | `PaymentVoucherPage.tsx:194-237` — layout purely doc-type driven |

### 2.6 Date & Period Controls (4 items · P1 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.2.6.1 | `period_close_day` (31, สิ้นเดือน) | P1 | ◐ | this PR | `monthly-close.service.ts:65-72`; `accounting.service.ts:490-502`; `period-lock.util.ts:52-56` — owner sets exact `closedUntil` date via API/UI; no separate "day-of-month" config (concrete close date ✅, abstract day rule ❌) |
| A1.2.6.2 | `period_grace_days` (5) | P1 | ❌ | this PR | No `grace_days`/`period_grace` key found. `period-lock.util.ts` enforces hard cutoff with no grace window. Closure is binary |
| A1.2.6.3 | `payment_date_warning_backdate` (30 days) | P1 | ❌ | this PR | `ReverseDialog.tsx:74-80` literal `30` days backdate threshold inline. No system_config read |
| A1.2.6.4 | `payment_date_allow_future` (true) | P1 | ❌ | this PR | `ReverseDialog.tsx:74-80` allows any future/past date silently; only ม.42 soft warning for >30d. Implicitly allowed; no toggle |

### 2.7 Reverse Entry (4 items · P1 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.2.7.1 | `reverse_reason_required` (true) | P1 | ❌ | this PR | DTO `void-expense.dto.ts:33,34` has `@IsOptional() reasonCode?` (back-compat); UI enforces via `canSubmit` only. Server doesn't require reason; no setting to flip |
| A1.2.7.2 | `reverse_reasons_dropdown` (6 options) | P1 | ❌ | this PR | Hardcoded `as const` enum at `void-expense.dto.ts:17-24` (REVERSE_REASON_CODES); UI mirror at `ReverseDialog.tsx:28-43`. No DB-driven dropdown |
| A1.2.7.3 | `reverse_manager_approval_days` (7) | P1 | ❌ | this PR | No `manager_approval` / 7-day match in voidDocument flow (`expense-documents.service.ts:1656-1830`). Single-step regardless of age |
| A1.2.7.4 | `reverse_block_cascaded` (true) | P1 | ❌ | this PR | Cascade-block at `expense-documents.service.ts:1669-1698` is unconditional `if (pendingSe > 0) throw`. Behavior correct but not toggleable |

### 2.8 Custom Income/Deduction (2 items · P1 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.2.8.1 | `custom_income_accounts_whitelist` (53-XXXX) | P1 | ✅ | this PR (C2 #871) | `payroll-custom.service.ts:27-41,74` reads `system_config.custom_income_accounts_whitelist` JSON array; migration `20260929000000_payroll_custom_income_deduction/migration.sql:49-58` seeds `["53-1104","53-1105"]`. UI mirror at `PayrollLinesSection.tsx:25-28` (hardcoded — should pull from API) |
| A1.2.8.2 | `tax_exempt_warning_enabled` (true) | P1 | ❌ | this PR | `PayrollLinesSection.tsx:409,413-414`; `types.ts:41` — `isTaxable` silent checkbox; types.ts:41 comment: "flag-only no UI confirm prompt". No ม.42 warning toggle |

### 3.1 Notifications (4 items · P2)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.3.1.1 | `draft_alerts_enabled` (true) | P2 | ❌ | this PR | Only cron is `expense-recurring.cron.ts:17` — no draft-alert flag |
| A1.3.1.2 | `ap_due_alerts` (true) | P2 | ❌ | this PR | AP-aging endpoint at `APAgingPage.tsx:75` + `analytics-aging.service.ts` — read-only reporting; no toggleable alert |
| A1.3.1.3 | `email_provider` (sendgrid) | P2 | ◐ | this PR | `email.service.ts:17-26` reads SMTP host/port/user/pass from `IntegrationConfig` (DB-backed); provider hardcoded to nodemailer/SMTP — `sendgrid` never referenced. Credentials configurable, provider choice not |
| A1.3.1.4 | `in_app_notifications` (true) | P2 | ❌ | this PR | `IN_APP` is enum value of `NotificationChannel` (`schema.prisma:237`) used unconditionally (`notifications.service.ts:986,1148,1278`). Always-on |

### 3.2 User Permissions RBAC (4 items · P2)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.3.2.1 | `roles_defined` (Owner/Manager/Accountant/Viewer) | P2 | ❌ | this PR | Hardcoded `enum UserRole { SALES, BRANCH_MANAGER, ACCOUNTANT, FINANCE_MANAGER, OWNER }` (`schema.prisma:18-24`). Differs from spec (Owner/Manager/Accountant/Viewer — no Viewer/Sales mapping). Schema change required |
| A1.3.2.2 | `settings_access_role` (Owner only) | P2 | ❌ | this PR | `settings.controller.ts:14-15` `@Roles('OWNER')`. OWNER-only correct but hardcoded decorator — not runtime-configurable |
| A1.3.2.3 | `post_permission` (role-based) | P2 | ❌ | this PR | `expense-documents.controller.ts:161-162` `@Post(':id/post') @Roles('OWNER','FINANCE_MANAGER','ACCOUNTANT')`. Hardcoded decorator |
| A1.3.2.4 | `reverse_permission` (Manager+) | P2 | ❌ | this PR | `expense-documents.controller.ts:167-168` `@Post(':id/void') @Roles('OWNER','FINANCE_MANAGER')`. Hardcoded decorator |

### 3.3 Integration (4 items · P2)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.3.3.1 | `export_enabled` (CSV+Excel+PDF) | P2 | ❌ | this PR | Excel: `ExpenseDailySummaryPage.tsx:75-121`; PDF: `pdf-report.service.ts:181-203` (recipients in SystemConfig `pdf_report_recipients`); CSV: `reports.controller.ts:241-248`. Always-on; no `export_enabled` flag |
| A1.3.3.2 | `bank_reconciliation` (manual) | P2 | ❌ | this PR | `receivable-recon.controller.ts:11-13` `@Roles(...)`; cron exists. Always-on; "manual" implicit (no auto-match flag) |
| A1.3.3.3 | `webhooks` (disabled) | P2 | ❌ | this PR | `webhooks.controller.ts:20-22` `@Controller('webhooks') @Roles('OWNER')`; full CRUD endpoints. No global default-off flag — endpoint always live |
| A1.3.3.4 | `api_keys` (admin only) | P2 | ❌ | this PR | `integrations.controller.ts` — 6 endpoints `@Roles('OWNER')` (lines 30,37,44,53,60,67); keys read via `IntegrationConfig.getValue()`. OWNER-only correct but hardcoded decorator |

### 3.4 Smart Switch (2 items · P2 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.3.4.1 | `smart_doctype_switch_enabled` (true) | P2 | ❌ | this PR | `ExpenseFormV4.tsx:96-102` always-on useEffect flipping SAMEDAY→ACCRUAL. No flag gate |
| A1.3.4.2 | `smart_switch_threshold_days` (0) | P2 | ❌ | this PR | `ExpenseFormV4.tsx:95-98` strict equality `documentDate === todayIso` (threshold=0 hardcoded). No threshold constant |

### 3.5 Expense Summary (3 items · P2 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.3.5.1 | `summary_default_range` (today) | P2 | ❌ | this PR | `ExpenseDailySummaryPage.tsx:54-56` defaults to today via `new Date().toISOString().slice(0,10)`. No setting; daily-only |
| A1.3.5.2 | `summary_all_range_warning` (true) | P2 | ❌ | this PR | No "all" range UI exists in `ExpenseDailySummaryPage.tsx`; only single-day input. No warning component. Feature not implemented |
| A1.3.5.3 | `summary_pagination_size` (50) | P2 | ❌ | this PR | `ExpensesPage.tsx:119` `usePaginationParams({ defaultSize: 50 })` hardcoded literal. Not from SystemConfig |

### 3.6 Multi-bill Picker (3 items · P2 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.3.6.1 | `settlement_max_bills_per_doc` (100) | P2 | ❌ | this PR | `SettlementLinesSection.tsx:28` URL `limit=100` hardcoded; API cap at `expense-documents.service.ts:965` `Math.min(100,...)`. Both UI+API literal 100; no SystemConfig key |
| A1.3.6.2 | `settlement_default_tick_behavior` (none) | P2 | ❌ | this PR | `SettlementLinesSection.tsx:34-43` `toggle()` starts with empty `value.selections` Map. "None" hardcoded by absence of init-select |
| A1.3.6.3 | `settlement_partial_payment_enabled` (true) | P2 | ❌ | this PR | `SettlementLinesSection.tsx:38-49` per-row amount override; backend V12 (`expense-documents.service.ts:222-225,706-712`) accepts `amountPaid≠netExpected`. Always-on through V12 adjustments; no flag |

### 4.1 UI & UX Defaults (4 items · P3)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.4.1.1 | `sidebar_collapsed` (false) | P3 | ◐ | this PR | `apps/web/src/components/layout/LayoutContext.tsx:13-29` default `true`, persisted to `localStorage['sidebar_collapse']`. Per-user via localStorage only; no UI toggle in /settings; no SystemConfig; default hardcoded `true` (icon-rail) |
| A1.4.1.2 | `show_keyboard_shortcuts` (true) | P3 | ❌ | this PR | `ShortcutsHelpOverlay.tsx:12-22` static `shortcuts[]` array; triggered by Shift+? via `useGlobalShortcuts.ts`. Always-available — no toggle |
| A1.4.1.3 | `animation_enabled` (true) | P3 | ❌ | this PR | `apps/web/src/index.css:618-627` `@media (prefers-reduced-motion: reduce)` only. Honors OS-level setting; no app-level toggle |
| A1.4.1.4 | `dark_mode` (true) | P3 | ◐ | this PR | `apps/web/src/main.tsx:107` `<ThemeProvider attribute="class" defaultTheme="light" enableSystem ...>`; toggle in `TopBar.tsx:265-275`. Per-user via next-themes (localStorage); default hardcoded `"light"` (spec wants `dark`); no OWNER default in SystemConfig |

### 4.2 Performance Tuning (5 items · P3)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.4.2.1 | `query_timeout_seconds` (30) | P3 | ❌ | this PR | `apps/api/src/prisma/prisma.service.ts:18` reads `pool_timeout` from env only; no statement-level timeout, no SystemConfig key |
| A1.4.2.2 | `cache_ttl_dashboard` (60s) | P3 | ❌ | this PR | `dashboard.service.ts:57` `this.cached(cacheKey, 60, ...)` — literal 60s. Hardcoded per-call; no override |
| A1.4.2.3 | `cache_ttl_reports` (300s) | P3 | ❌ | this PR | No cache layer in `reports/`/`reporting/`; global default `cache.module.ts:28,35` `ttl: 300` (matches spec value but only `dashboard.service` uses cached()) |
| A1.4.2.4 | `batch_size_import` (500) | P3 | ❌ | this PR | `migration.service.ts:34-100` sequential `for` loop, no chunking. No batch_size constant |
| A1.4.2.5 | `max_concurrent_jobs` (5) | P3 | ❌ | this PR | `notification.worker.ts:13` `@Processor` without concurrency option; grep `concurrency` = 0 hits. BullMQ default (1). Retry attempts hardcoded 3 at `notification-queue.service.ts:49` |

### 4.3 Audit & Compliance (6 items · P3)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.4.3.1 | `audit_log_retention_days` (1825 = 5 ปี) | P3 | ◐ | this PR | `audit-retention.cron.ts:24,29-34` — `DEFAULT_RETENTION_DAYS = 180`, reads `process.env.AUDIT_LOG_RETENTION_DAYS`. Env-tunable only; default 180d vs spec 1825d. OWNER can't change at runtime |
| A1.4.3.2 | `audit_log_archive` (enabled) | P3 | ✅ | this PR | `audit-retention.cron.ts:36-50` — soft-archive via `archivedAt`; DB trigger `20260520300000_audit_log_archive_immutable` blocks hard deletes. Unconditionally enabled by design |
| A1.4.3.3 | `document_retention_years` (5) | P3 | ❌ | this PR | `pdpa.service.ts:30-31` privacy-notice text mentions "5 ปีหลังปิดสัญญา" as static string only; no enforcement code, no SystemConfig key |
| A1.4.3.4 | `data_export_format` (JSON) | P3 | ❌ | this PR | `pdpa.controller.ts` DSAR endpoints — no export-format param, no JSON/CSV branch. Data-export endpoint not implemented; only DSAR request workflow |
| A1.4.3.5 | `pii_masking` (enabled) | P3 | ✅ | this PR | `apps/api/src/utils/pii.util.ts:60,70` (`maskNationalId`, `maskPhone`); enforced at `customers.controller.ts:32`, `trade-in.controller.ts:32`; audit `pii-audit.service.ts:25` (`PII_DECRYPT_MASKED` vs `PII_DECRYPT_FULL`). Unconditional at controller layer; decrypt-full requires authorization + audit |
| A1.4.3.6 | `login_log` (enabled) | P3 | ✅ | this PR | `auth/login-audit.service.ts:36-60` (`LoginAuditService.record`); retention `auth/login-audit-retention.cron.ts:17` `RETENTION_DAYS = 90` (hardcoded). Unconditional fire-and-forget |

## Item count verification

- 1.1–1.6 (P0): 7+5+6+4+5+3 = **30** ✓
- 2.1–2.8 (P1): 6+7+6+5+3+4+4+2 = **37** ✓
- 3.1–3.6 (P2): 4+4+4+2+3+3 = **20** ✓
- 4.1–4.3 (P3): 4+5+6 = **15** ✓
- **Total: 102** ✓

## Phase 1 Decision Log (audit findings only — NOT scope decisions)

- **2026-05-16:** Phase 1 dispatched as 6 parallel Explore agents (Opus). All 102 items audited read-only against the live codebase.
- **2026-05-16:** Findings cross-referenced against recent feature PRs (B1 #861, B2 #863, C1 #867/#868, C2 #871/#872, C3 #875/#876, C4 #877/#878) — recent features ship with hardcoded values, not settings, **as expected** per "scope was shipping the feature; settings are A1/D1 territory."
- **2026-05-16:** Two notable mismatches caught during scan (defer to Phase 2 for resolution):
  - `petty_cash_account` default in code (`'11-1201'`) vs spec (`'11-1103'`)
  - `audit_log_retention_days` default (180d) vs spec (1825d for พ.ร.บ.บัญชี ม.7)
  - `doc_prefix_per_type` abbreviations differ: code uses `EX/SE/PR/CN/PC`, spec wrote `EXP/SET/PAY/CN/PC`
- **2026-05-16:** `UserRole` enum mismatch — code has 5 roles (SALES/BRANCH_MANAGER/ACCOUNTANT/FINANCE_MANAGER/OWNER); spec wants 4 (Owner/Manager/Accountant/Viewer). Schema change required if A1.3.2.1 is approved for D1.
- **2026-05-16 (3 review rounds — counts and findings now trustworthy):** Two re-grep passes (R1B + R2B) caught 4 false negatives: `A1.1.3.2 wht_rates` ❌→◐ (UI SelectItem partial coverage), `A1.1.6.1/2 adj_underpay/overpay_account` ❌→◐ (`account_role_map` migration SEEDS the roles but consumers hardcode literals → "dead config" pattern), `A1.2.3.6 per_user_override` ❌→✅ (`User.preferences Json` + `PATCH /auth/me/preferences` endpoint already in prod). Spot-check found `A1.1.3.1 VAT_RATE` evidence claimed an end-to-end wiring that doesn't exist (UI writes `VAT_RATE`, consumer reads `vat_pct`) — that's a real product bug, raised as Q6. Strengthened: `A1.1.5.4` flagged as "dead setting"; `A1.1.2.2` flagged on format+cycle mismatch. Headline recount fixed two undercounts. **Final post-review counts: TOTAL ✅ 12 / ◐ 18 / ❌ 71 / SKIP 1.** Under codified tie-breaker (◐ counts toward missing): P0 missing = 22/29 = 76%; P1 missing = 35/37 = 95%.

## Open Questions (raised by audit — for owner's Phase 2 input)

- [ ] Q1: `petty_cash_account` — keep current default `'11-1201'` or change to spec `'11-1103'`? (Note: 11-1103 is "เงินสด — พนักงานบัญชี" which makes accounting sense for the float account; 11-1201 is KBank — using a bank account for petty cash is unusual)
- [ ] Q2: `audit_log_retention_days` — spec asks 1825d (5 yr) per พ.ร.บ.บัญชี ม.7, code defaults to 180d. Confirm raise to 1825d. (Compliance question, not just UI preference.)
- [ ] Q3: `doc_prefix_per_type` — accept the code's actual abbreviations (`EX/CN/PR/SE/PC`) as the new spec, or rename to spec's (`EXP/SET/PAY/CN/PC`)? Renaming touches every existing document number — likely big-bang migration. Recommend accept-actuals unless owner has business reason.
- [ ] Q4: `UserRole` mismatch — spec wants {Owner, Manager, Accountant, Viewer}; code has {SALES, BRANCH_MANAGER, ACCOUNTANT, FINANCE_MANAGER, OWNER}. Add Viewer? Collapse SALES + BRANCH_MANAGER + FINANCE_MANAGER into "Manager"? Both are big changes.
- [ ] Q5: `email_provider` (sendgrid) — code uses SMTP via nodemailer (works fine in prod). Forcing sendgrid requires API key + SDK swap. Drop spec's "sendgrid" requirement?
- [ ] **Q6 (P0 correctness bug, surfaced by R1A):** `VAT_RATE` orphan-key — `SettingsPage/tabs/VatTab.tsx:26,35` writes SystemConfig key `VAT_RATE` but `purchase-orders.service.ts:99` reads a different key `vat_pct`. The UI setting is non-functional — consumer always falls back to `0.07`. Fix path: (a) rename consumer to read `VAT_RATE`, (b) rename UI to write `vat_pct`, or (c) introduce typed `VatService` that owns the key name. **This is a real product bug, not just config grooming** — pick a fix even before Phase 2 verdict.
- [ ] **Q7 (dead-config pattern, surfaced by R2B):** `account_role_map` seeded with `adj_underpay → 52-1104` and `adj_overpay → 53-1503` but consumers at `payment-receipt-2b.template.ts` / `payment-receipt-2b-split.template.ts` / `payments.service.ts` still hardcode the literals — they don't call `accountRoleService.getAccountForRole()`. Wire all consumers to the service (proper config-driven flow), or accept hardcoded literals and remove the unused `account_role_map` rows?
- [ ] **Q8 (dead-setting pattern, surfaced by R1C):** `petty_cash_replenish_threshold` (A1.1.5.4) is read by `petty-cash.service.ts:41-44` but the interface comment is explicit "advisory, not enforced" — no consumer acts on it. Worse than hardcoded — gives false confidence. Kill the dead setting (remove the read), or wire enforcement (block submit / show warning when balance < threshold)?

## Dependencies

- ✅ T0 (tracking infrastructure exists)
- ✅ A0 (Pre-flight Verify) completed 2026-05-16
- 🛑 **Owner approval required before Phase 2 synthesis**
- After Phase 2 reports, owner approves scope → D1 (Phase 4) begins

## 🛑 STOP — Phase 1 complete, awaiting owner review

**Anti-pattern #1 reminder:** do NOT chain Phase 1 → Phase 2 in the same response. This PR is Phase 1 findings only. Owner reviews the headline + the 5 open questions, then signals "go ahead to Phase 2" — which produces a per-sub-section verdict (✅ APPROVE / ◐ DEFER / ⏸ SKIP) and a draft scope for D1. **No implementation yet.**
