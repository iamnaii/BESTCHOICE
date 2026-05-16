# D1 · Settings Audit Phase 4 (Implement Approved Scope)

**Status:** 🟢 In Progress — owner approved expanded scope 2026-05-16
**Started:** 2026-05-16  |  **PRs:** #882-#897 · this PR (D1.2.2.6)  |  **Done:** 17/75 — 2.6 ✅ · 2.7 ✅ · 2.2 ✅ Complete (7/7)
**Spec:** [`../specs/2026-05-16-a1-phase2-decision-report.md`](../specs/2026-05-16-a1-phase2-decision-report.md)  ·  **Plan:** —

## Context

A1 Phase 1+2 completed (#879 + this companion PR for Phase 2). Owner approved expanded D1 scope: include APPROVE (22 items) + DEFER (~53 items) — total ~75 items. SKIP sub-sections (5) stay out. Items implemented one-PR-each per anti-pattern #3.

## Source

- [A1 Phase 1 findings](A1-settings-audit.md) (PR #879)
- [A1 Phase 2 decision report](../specs/2026-05-16-a1-phase2-decision-report.md)
- [Settings Audit Index](_owner-package/Settings_Audit_Index.md) decision framework
- [Settings Audit Core v2.0](_owner-package/Settings_Audit_Core_v2.0.md)

## Phase

🟢 **Phase 4: IMPLEMENT** — one PR per item.

## Execution order (Q-unblocked first)

Sub-prioritization within expanded D1 scope:
1. **Q-unblocked + cheap** (start now): 2.2 / 2.6 / 2.7 / 2.8 / 1.6 / 4.3.1 / 2.3 / 2.4 / 2.5 / 3.3 / 3.5 / 3.6
2. **Q-unblocked + big**: 2.1 Approval Workflow (likely separate sub-project)
3. **Q-blocked, waiting on Q1–Q8 answers**: 1.1 / 1.2 / 1.3 / 1.5 / 3.1 / 3.2

## Items Checklist

(IDs preserve A1 numbering: `D1.<section>.<subsection>.<item>` ↔ `A1.<section>.<subsection>.<item>`.)

### Q-unblocked items (~30 cheap items — start immediately)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| D1.2.8.2 | `tax_exempt_warning_enabled` (UI ม.42 warning toggle) | P1 | ✅ | this PR | `SystemConfig.TAX_EXEMPT_WARNING_ENABLED` (default true, OWNER-editable via existing PATCH /settings). New `GET /settings/ui-flags` endpoint (authenticated, all roles). New `useUiFlags()` hook + warning row in `CustomIncomeSubTable` (PayrollLinesSection.tsx) when any custom-income line has `isTaxable=false` and flag is on. 4 unit tests on getUiFlags. Pattern: reusable for future D1 UI flags |
| D1.4.3.1 | `audit_log_retention_days` 180→1825d (พ.ร.บ.บัญชี ม.7 compliance) | P3 | ✅ | this PR | `AuditRetentionCron.DEFAULT_RETENTION_DAYS` raised 180→1825 (5 yr per ม.7). Precedence: SystemConfig key `audit_log_retention_days` → env `AUDIT_LOG_RETENTION_DAYS` → default 1825. Read via PrismaService directly (avoids AuditModule↔SettingsModule circular dep). 6/6 tests pass incl. new precedence + DB-failure paths |
| D1.1.6.1 | `adj_underpay_account` (wire consumers to AccountRoleService) | P0 | ⬜ | — | `payment-receipt-2b.template.ts:249`, `payment-receipt-2b-split.template.ts:212`, `payments.service.ts:1989`, `AdjustmentSection.tsx:30` |
| D1.1.6.2 | `adj_overpay_account` (wire consumers to AccountRoleService) | P0 | ⬜ | — | Same pattern with 53-1503 |
| D1.1.6.3 | `adj_auto_route` toggle | P0 | ⬜ | — | Flag in SystemConfig + check in template |
| D1.2.2.1 | `company_name` (CompanyInfo wire) | P1 | ✅ | this PR | **Foundation for 2.2 sub-section.** New `GET /companies/public` (authenticated, all roles, returns public-safe SHOP+FINANCE fields). New `useCompanyInfo()` + `useCompanyDisplayName()` hooks in apps/web/src/hooks/useCompanyInfo.ts. All 4 hardcoded `BESTCHOICE FINANCE × SHOP` literals in PaymentVoucherPage.tsx (lines 271/456/625/827 across PettyCashSheet/PayrollSlipSheet/Sheet/WhtCertificate) replaced with `{companyName}` from the hook. Fallback to legacy literal if API hasn't responded yet. 3 new service tests on findPublic |
| D1.2.2.2 | `company_address` (CompanyInfo wire) | P1 | ✅ | this PR | New `useCompanyAddress()` hook (prefers FINANCE then SHOP). Replaces all 4 hardcoded "เลขประจำตัวผู้เสียภาษี · สำนักงานใหญ่" placeholders in PaymentVoucherPage components. Re-uses the existing /companies/public endpoint from D1.2.2.1. Type-check 0 errors |
| D1.2.2.3 | `tax_id` (CompanyInfo wire) | P1 | ✅ | this PR | New `useCompanyTaxId()` hook. Voucher sub-header now shows `{address} · เลขผู้เสียภาษี {taxId}` inline. Hidden when CompanyInfo absent. Re-uses /companies/public. Type-check 0 errors |
| D1.2.2.4 | `logo_url` (upload + render) | P1 | ✅ | this PR | `useCompanyLogoUrl()` hook + `<img>` render before `<h1>` in 3 voucher headers (PettyCashSheet/PayrollSlipSheet/Sheet). Hidden when null. h-12 contain-fit. Upload UI not in scope — uses existing CompanyInfo.logoUrl set via /companies CRUD. Type-check 0 errors |
| D1.2.2.5 | `theme_color` admin override | P1 | ✅ | this PR | SystemConfig `theme_color` (default `#10b981`). Hex format validated `^#[0-9a-fA-F]{6}$`. **Informational only** — Tailwind v4 uses `--color-primary-50..900` scale; single-hex override doesn't drive design tokens directly. Future enhancement: compute the full scale or switch theme runtime |
| D1.2.2.6 | `language` (i18n) | P1 | ✅ | this PR | SystemConfig `language` (whitelisted `th`/`en`, default `th`). `useUiFlags()` applies value to `document.documentElement.lang` via useEffect. **i18n framework deferred** — no translation tables yet, strings stay in their authored Thai. OWNER editing today affects: (a) `<html lang>` attr for a11y readers, (b) `<input>` locale heuristics. Future PR adds react-i18next |
| D1.2.2.7 | `show_qr_code` toggle | P1 | ✅ | this PR | SystemConfig `voucher_show_qr_code` (default true). `getUiFlags()` exposes `voucherShowQrCode`. Sheet voucher component renders `<QRCodeSVG value="{origin}/verify/{doc.number}" size=80>` + "สแกนเพื่อตรวจสอบ" caption above footer. Hidden when flag off. PettyCash/Payroll/WhtCertificate not included (smaller layouts) — can be added in a follow-up if owner wants |
| D1.2.6.1 | `period_close_day` | P1 | ✅ | this PR | SystemConfig `period_close_day` (default 31). `getUiFlags()` returns `periodCloseDay` clamped to 1-31. **Informational for now** — period-lock still anchors at calendar month-end. Future enhancement: shift period boundary when ≠ 31. 4 new tests (default / valid range / out-of-range clamp / zero clamp) |
| D1.2.6.2 | `period_grace_days` | P1 | ✅ | this PR | SystemConfig key `period_grace_days` (default 5). `period-lock.util.ts:validatePeriodOpen` extended — closed-period throws only if today > periodLastDay + graceDays (Tier 1) or today > closedUntil + graceDays (Tier 2). 10 new tests (CLOSED within/beyond grace, SYNCED, OPEN, OWNER override 0/30, malformed/negative fallback, legacy Tier 2). Direct callers (journal-auto, expense-documents, receipts) all pass |
| D1.2.6.3 | `payment_date_warning_backdate` | P1 | ✅ | this PR | SystemConfig `payment_date_warning_backdate` (default 30). `getUiFlags()` exposes `paymentDateWarningBackdate`; ReverseDialog hardcoded `30` replaced with the flag (both the threshold for the broader warning AND the upper bound for the 7d manager-approval warning). 2 new tests on default + override |
| D1.2.6.4 | `payment_date_allow_future` toggle | P1 | ✅ | this PR | SystemConfig `payment_date_allow_future` (default true). Server `voidDocument` rejects future-dated `reverseDate` when flag off. UI: ReverseDialog shows destructive inline error + disables submit. 2 settings tests + 2 void path tests added |
| D1.2.7.1 | `reverse_reason_required` | P1 | ✅ | this PR | Server-side gate in `voidDocument` (reads `reverse_reason_required`, default true). UI: `useUiFlags()` reads `reverseReasonRequired` from `/settings/ui-flags`; `ReverseDialog` shows "— ไม่ระบุ —" + drops `*` when flag off + relaxes `canSubmit`. 3 new tests on the void path + 2 new getUiFlags tests |
| D1.2.7.2 | `reverse_reasons_dropdown` | P1 | ✅ | this PR | SystemConfig key `reverse_reasons` JSON `[{code,label}]` array. Defaults to 6 canonical codes. Backend: DTO relaxed (drops @IsIn); `voidDocument` validates reasonCode against configured whitelist; `getReverseReasons()` helper in both service + ExpenseDocumentsService. UI: `useUiFlags().reverseReasons` drives the dropdown. 5 settings tests + 2 void path tests added |
| D1.2.7.3 | `reverse_manager_approval_days` | P1 | ✅ | this PR | Soft UI warning (per C3 Q2 owner decision). SystemConfig `reverse_manager_approval_days` (default 7). `getUiFlags()` exposes it; `ReverseDialog` shows "ควรมีอนุมัติจากผู้จัดการ" warning when daysBackdate exceeds threshold (but ≤30; the broader 30+ warning supersedes). No server block. 3 new tests on the threshold default + override + unparseable fallback |
| D1.2.7.4 | `reverse_block_cascaded` toggle | P1 | ✅ | this PR | New private helper `readBoolFlag()` in `ExpenseDocumentsService` (reads `system_config` directly via PrismaService to keep ctor lean + avoid circular-dep risk with audit/settings modules). Cascade-block check at `expense-documents.service.ts:1681-1700` now reads `reverse_block_cascaded` (default true). Both CN and SE cascade throws gated by the same flag. 2 new tests (toggle off → both bypassed; default → preserved). 52/52 service-spec tests pass |
| D1.2.3.1 | `default_time_range` | P1 | ⬜ | — | DateRangeChips presets configurable |
| D1.2.3.2 | `pagination_size` | P1 | ⬜ | — | Central default for list pages |
| D1.2.3.3 | `date_format` BE↔ค.ศ. toggle | P1 | ⬜ | — | formatDateShort branch on pref |
| D1.2.3.4 | `decimal_places` | P1 | ⬜ | — | formatNumberDecimal default from pref |
| D1.2.3.5 | `thousands_separator` | P1 | ⬜ | — | toLocaleString locale from pref |
| D1.2.4.1 | `templates_enabled` flag | P1 | ⬜ | — | Feature flag at controller |
| D1.2.4.2 | `max_templates_per_user` quota | P1 | ⬜ | — | Count check in createTemplate |
| D1.2.4.3 | `sharing_rules` (ACL) | P1 | ⬜ | — | Schema: add visibility + sharedWith |
| D1.2.4.4 | `variables_support` formalization | P1 | ⬜ | — | Define `{{var}}` interpolation syntax |
| D1.2.4.5 | Template `categories` table | P1 | ⬜ | — | New TemplateCategory model |
| D1.2.5.1 | `voucher_print_mode_default` | P1 | ⬜ | — | single vs multi page mode |
| D1.2.5.2 | `voucher_include_adjustment` | P1 | ⬜ | — | Render adjustments in print template |
| D1.2.5.3 | `voucher_show_partial_columns` | P1 | ⬜ | — | Partial column display flag |
| D1.3.3.1 | `export_enabled` flag | P2 | ⬜ | — | Gate Excel/PDF/CSV exports |
| D1.3.3.2 | `bank_reconciliation` mode | P2 | ⬜ | — | manual vs auto-match flag |
| D1.3.3.3 | `webhooks` default-off | P2 | ✅ | this PR | SystemConfig `webhooks_enabled` (**DEFAULT-OFF** per accountant package). `WebhooksService.dispatchEvent` (outbound dispatcher for payment.created / contract events etc.) short-circuits to silent no-op when off so business flows don't break on side-effect. `sendTestEvent` throws Thai BadRequest so OWNER test-button click is loud. Reads SystemConfig directly via PrismaService (PR #884 lean pattern). **NOT applied to inbound webhooks** — paysolutions / sms / line / facebook are critical for payment processing and run on dedicated controllers. Frontend: `useUiFlags().webhooksEnabled` (default false). 6 new tests (2 settings + 4 webhooks service) |
| D1.3.3.4 | `api_keys` admin admin | P2 | ⬜ | — | Already OWNER-only; flag as config |
| D1.3.5.1 | `summary_default_range` | P2 | ⬜ | — | ExpenseDailySummaryPage default |
| D1.3.5.2 | `summary_all_range_warning` | P2 | ⬜ | — | New UI warning |
| D1.3.5.3 | `summary_pagination_size` | P2 | ⬜ | — | Configurable from pref |
| D1.3.6.1 | `settlement_max_bills_per_doc` | P2 | ⬜ | — | Replace literal 100 at SettlementLinesSection.tsx:28 |
| D1.3.6.2 | `settlement_default_tick_behavior` | P2 | ⬜ | — | Initial-select logic |
| D1.3.6.3 | `settlement_partial_payment_enabled` | P2 | ⬜ | — | Toggle V12 adjustments |

### Q-unblocked + bigger (6 items, Approval Workflow)

| ID | Item | Priority | Status | PR | Notes |
|---|---|---|---|---|---|
| D1.2.1.1 | `approval_enabled` | P1 | ⬜ | — | Feature flag check at create/post |
| D1.2.1.2 | `approval_threshold` 50,000 ฿ | P1 | ⬜ | — | Amount-based gate |
| D1.2.1.3 | `approvers_list` user IDs | P1 | ⬜ | — | DB-driven, replace hardcoded APPROVER_ROLES |
| D1.2.1.4 | `approval_required_doc_types` ([PAYROLL]) | P1 | ⬜ | — | Doctype filter |
| D1.2.1.5 | `notification_on_pending` | P1 | ⬜ | — | Hook into existing notifier |
| D1.2.1.6 | `auto_post_on_approve` + DocumentStatus enum extension | P1 | ⬜ | — | Schema change: add PENDING_APPROVAL/APPROVED |

### Q-blocked items (wait for Q1–Q8 answers in PR #879)

| ID | Item | Priority | Status | Q-gate | Notes |
|---|---|---|---|---|---|
| D1.1.1.2 | `GET /api/settings/role-map` | P0 | ⬜ | Q7 | Wire AccountRoleService or drop table? |
| D1.1.1.3 | `PUT /api/settings/role-map` | P0 | ⬜ | Q7 | |
| D1.1.1.4 | Admin UI for role map | P0 | ⬜ | Q7 | |
| D1.1.1.5 | Validation rules | P0 | ⬜ | Q7 | |
| D1.1.1.6 | Audit log on change | P0 | ⬜ | Q7 | |
| D1.1.1.7 | Permission control (admin only) | P0 | ⬜ | Q7 | |
| D1.1.2.1 | `doc_prefix_per_type` | P0 | ⬜ | Q3 | Rename or accept current? |
| D1.1.2.2 | `doc_number_format` | P0 | ⬜ | Q3 | Same |
| D1.1.2.3 | `reset_cycle` | P0 | ⬜ | Q3 | |
| D1.1.2.4 | `sequence_table` | P0 | ⬜ | Q3 | |
| D1.1.2.5 | Admin reset capability | P0 | ⬜ | Q3 | |
| D1.1.3.1 | `vat_rate` (Q6 P0 bug fix first) | P0 | ⬜ | Q6 | **VAT_RATE/vat_pct orphan-key fix** |
| D1.1.3.2 | `wht_rates` (1/3/5/10/15) | P0 | ⬜ | — | Mostly unblocked — extend SelectItem + table |
| D1.1.3.3 | `sso_rate` (locked at 5% by law) | P0 | ⬜ | — | Just document the lock in service comment |
| D1.1.3.5 | effective_date support | P0 | ⬜ | — | Per-rate effective dates |
| D1.1.3.6 | Admin UI (tax rates tab) | P0 | ⬜ | — | New /settings/tax-rates route |
| D1.1.5.1 | `petty_cash_enabled` | P0 | ⬜ | Q1 | Feature flag |
| D1.1.5.4 | `petty_cash_replenish_threshold` (dead setting decision) | P0 | ⬜ | Q8 | Kill or wire |
| D1.1.5.5 | `petty_cash_custodian` (FK) | P0 | ⬜ | Q1 | Schema + assignment UI |
| D1.3.1.1 | `draft_alerts_enabled` | P2 | ⬜ | — | New cron + flag |
| D1.3.1.2 | `ap_due_alerts` | P2 | ⬜ | — | Hook AP aging to notifier |
| D1.3.1.3 | `email_provider` | P2 | ⬜ | Q5 | sendgrid vs SMTP |
| D1.3.1.4 | `in_app_notifications` toggle | P2 | ⬜ | — | Channel disable |
| D1.3.2.1 | `roles_defined` (add Viewer?) | P2 | ⬜ | Q4 | Schema change |
| D1.3.2.2 | `settings_access_role` | P2 | ⬜ | Q4 | Runtime-editable role binding |
| D1.3.2.3 | `post_permission` | P2 | ⬜ | Q4 | |
| D1.3.2.4 | `reverse_permission` | P2 | ⬜ | Q4 | |

## Decision Log

- **2026-05-16:** Owner approved expanded scope ("ทำ DEFER และ skip"): include DEFER items in D1, leave SKIP items out. Total ~75 items.
- **2026-05-16:** Execution order: Q-unblocked items first (cheapest P1/P2/P3), then big Q-unblocked (2.1 Approval Workflow), then Q-blocked once owner answers Q1–Q8.
- **2026-05-16:** Anti-pattern #3 reinforced — one PR per item, no bundling. PR titles use schema `feat(a1): D1.<x.y.z> — <short>`.

## Open Questions (inherited from A1)

Q1–Q8 from PR #879 — pending owner answers. Each gates specific items in the Q-blocked table above.

## Dependencies

- ✅ A1 Phase 1 (#879)
- ✅ A1 Phase 2 (this companion PR)
- 🔓 Owner approved expanded scope 2026-05-16
- 🟡 Q1–Q8 still pending — gates some items but doesn't block start
