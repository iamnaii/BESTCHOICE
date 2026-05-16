# D1 · Settings Audit Phase 4 (Implement Approved Scope)

**Status:** 🟢 In Progress — owner approved expanded scope 2026-05-16
**Started:** 2026-05-16  |  **PRs:** #882 · #883 · #884 · #885 · this PR (D1.2.7.2)  |  **Done:** 5/75
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
| D1.2.2.1 | `company_name` (CompanyInfo wire) | P1 | ⬜ | — | Replace `<h1>BESTCHOICE FINANCE × SHOP</h1>` at PaymentVoucherPage.tsx:270,455,624,826 |
| D1.2.2.2 | `company_address` (CompanyInfo wire) | P1 | ⬜ | — | Replace placeholder Thai at :271-272 etc. |
| D1.2.2.3 | `tax_id` (CompanyInfo wire) | P1 | ⬜ | — | |
| D1.2.2.4 | `logo_url` (upload + render) | P1 | ⬜ | — | CompanyInfo.logoUrl already in schema |
| D1.2.2.5 | `theme_color` admin override | P1 | ⬜ | — | Tailwind CSS var override at runtime |
| D1.2.2.6 | `language` (i18n) | P1 | ⬜ | — | Larger — defer if time short |
| D1.2.2.7 | `show_qr_code` toggle | P1 | ⬜ | — | qrcode.react already imported in MobileReceipt |
| D1.2.6.1 | `period_close_day` | P1 | ⬜ | — | Already supports closedUntil date; add day-of-month config wrapper |
| D1.2.6.2 | `period_grace_days` | P1 | ⬜ | — | Wrap period-lock.util with grace check |
| D1.2.6.3 | `payment_date_warning_backdate` | P1 | ⬜ | — | Replace hardcoded `30` at ReverseDialog.tsx:74,167 |
| D1.2.6.4 | `payment_date_allow_future` toggle | P1 | ⬜ | — | Block-or-warn on future-dated reverse |
| D1.2.7.1 | `reverse_reason_required` | P1 | ✅ | this PR | Server-side gate in `voidDocument` (reads `reverse_reason_required`, default true). UI: `useUiFlags()` reads `reverseReasonRequired` from `/settings/ui-flags`; `ReverseDialog` shows "— ไม่ระบุ —" + drops `*` when flag off + relaxes `canSubmit`. 3 new tests on the void path + 2 new getUiFlags tests |
| D1.2.7.2 | `reverse_reasons_dropdown` | P1 | ✅ | this PR | SystemConfig key `reverse_reasons` JSON `[{code,label}]` array. Defaults to 6 canonical codes. Backend: DTO relaxed (drops @IsIn); `voidDocument` validates reasonCode against configured whitelist; `getReverseReasons()` helper in both service + ExpenseDocumentsService. UI: `useUiFlags().reverseReasons` drives the dropdown. 5 settings tests + 2 void path tests added |
| D1.2.7.3 | `reverse_manager_approval_days` | P1 | ⬜ | — | Age-gate the void path |
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
| D1.3.3.3 | `webhooks` default-off | P2 | ⬜ | — | Global gate on webhooks.controller |
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
