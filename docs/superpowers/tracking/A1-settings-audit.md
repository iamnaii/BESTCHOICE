# A1 · Settings Audit Phase 1+2 (Scan + Report)

**Status:** ⬜ Pending  |  **Started:** —  |  **PRs:** —
**Spec:** —  ·  **Plan:** —

## Context

Run a read-only scan of the codebase against the 102 settings owner enumerated in `Settings_Audit_Core_v2.0`. For each item, mark ✅ Exists / ❌ Missing / ◐ Partial with a file:line evidence pointer. Phase 2 produces a markdown summary table. **Hard stop** at end of Phase 2 — owner reviews and approves which items go into D1 (Phase 4 Implement) before any code change happens.

## Source

- [Settings Audit Core v2.0](_owner-package/Settings_Audit_Core_v2.0.md) — 102 items with Detection Hints
- [Settings Audit Index](_owner-package/Settings_Audit_Index.md) — overview + decision framework
- [Settings Audit Change Log](_owner-package/Settings_Audit_Change_Log.md) — v1.0 → v2.0 diff

## Phase

🚦 **Phase 1: AUDIT** (not started) → Phase 2: REPORT → 🛑 **STOP** for owner approval → D1 (Phase 4: IMPLEMENT)

Anti-pattern reminder: do **not** implement settings while scanning. AUDIT is read-only.

## Decision Framework (from `_owner-package/Settings_Audit_Index.md`)

After Phase 2 produces results, owner decides per sub-section:
- ✅ APPROVE: P0 ≥ 80% missing + P1 ≥ 50% missing → implement
- ◐ DEFER: P0 ≥ 50% missing but P1 < 50% → P0 only this sprint
- ⏸ SKIP: P0 < 50% missing → system already covers

## Items Checklist

> **102 items total.** Numbering preserves owner's source format: `A1.<section>.<subsection>.<item>` maps to Settings Audit Core `<section>.<subsection>` heading.

### 1.1 Account Role Map (7 items · P0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.1.1.1 | DB table: `account_role_map` | P0 | ⬜ | — | Hint: ตรวจ migration files + schema |
| A1.1.1.2 | `GET /api/settings/role-map` | P0 | ⬜ | — | Hint: ตรวจ controller |
| A1.1.1.3 | `PUT /api/settings/role-map` | P0 | ⬜ | — | Hint: ตรวจ controller |
| A1.1.1.4 | Admin UI for role map | P0 | ⬜ | — | Hint: ตรวจ React component |
| A1.1.1.5 | Validation rules | P0 | ⬜ | — | Hint: ตรวจ validator |
| A1.1.1.6 | Audit log on change | P0 | ⬜ | — | Hint: ตรวจ audit table |
| A1.1.1.7 | Permission control (Admin only) | P0 | ⬜ | — | Hint: ตรวจ middleware |

### 1.2 Document Numbering (5 items · P0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.1.2.1 | `doc_prefix_per_type` (EXP/SET/PAY/CN/PC) | P0 | ⬜ | — | Hint: enum DocType |
| A1.1.2.2 | `doc_number_format` (YYMMNNN) | P0 | ⬜ | — | Hint: doc generator |
| A1.1.2.3 | `reset_cycle` (yearly) | P0 | ⬜ | — | Hint: sequence reset logic |
| A1.1.2.4 | `sequence_table` (doc_sequences) | P0 | ⬜ | — | Hint: schema |
| A1.1.2.5 | Admin reset capability | P0 | ⬜ | — | Hint: admin route |

### 1.3 Tax Rates (6 items · P0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.1.3.1 | `vat_rate` (7%) | P0 | ⬜ | — | Hint: tax_rates table |
| A1.1.3.2 | `wht_rates` (1/3/5/10/15) | P0 | ⬜ | — | Hint: wht_rate enum |
| A1.1.3.3 | `sso_rate` (5%) | P0 | ⬜ | — | Hint: payroll calculator |
| A1.1.3.4 | `sso_max` (refined → 1.4) | P0 | ⬜ | — | See section 1.4 |
| A1.1.3.5 | effective_date support | P0 | ⬜ | — | Hint: schema มี effective_from |
| A1.1.3.6 | Admin UI | P0 | ⬜ | — | Hint: /settings/tax-rates |

### 1.4 SSO Configurable (4 items · P0 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.1.4.1 | `sso_salary_ceiling` (17,500 ฿ default 2569) | P0 | ⬜ | — | Hint: ค้นหา `15000` hard-coded — likely ❌ |
| A1.1.4.2 | `sso_max_contribution` (875 ฿ default 2569) | P0 | ⬜ | — | Hint: ค้นหา `750` hard-coded — likely ❌ |
| A1.1.4.3 | `sso_effective_from`/`to` | P0 | ⬜ | — | Hint: ตรวจ schema |
| A1.1.4.4 | Stepped ceiling support (2569 → 2572 → 2575) | P0 | ⬜ | — | Hint: historical query |

### 1.5 Petty Cash (5 items · P0 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.1.5.1 | `petty_cash_enabled` (true default) | P0 | ⬜ | — | Hint: feature flag |
| A1.1.5.2 | `petty_cash_account` (11-1103) | P0 | ⬜ | — | Hint: CoA |
| A1.1.5.3 | `petty_cash_limit` (5,000 ฿) | P0 | ⬜ | — | Hint: V20 implementation |
| A1.1.5.4 | `petty_cash_replenish_threshold` (1,000 ฿) | P0 | ⬜ | — | Hint: alert logic |
| A1.1.5.5 | `petty_cash_custodian` (employee FK) | P0 | ⬜ | — | Hint: user assignment |

### 1.6 Adjustment Routing (3 items · P0 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.1.6.1 | `adj_underpay_account` (52-1104) | P0 | ⬜ | — | Hint: `getDefaultAdjustmentAccount()` |
| A1.1.6.2 | `adj_overpay_account` (53-1503) | P0 | ⬜ | — | Hint: direction handling |
| A1.1.6.3 | `adj_auto_route` (true) | P0 | ⬜ | — | Hint: auto-route logic |

### 2.1 Approval Workflow (6 items · P1)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.2.1.1 | `approval_enabled` | P1 | ⬜ | — | Hint: feature flag |
| A1.2.1.2 | `approval_threshold` (50,000 ฿) | P1 | ⬜ | — | Hint: amount check |
| A1.2.1.3 | `approvers_list` (user IDs) | P1 | ⬜ | — | Hint: approvers table |
| A1.2.1.4 | `approval_required_doc_types` ([PAYROLL]) | P1 | ⬜ | — | Hint: enum check |
| A1.2.1.5 | `notification_on_pending` (email + in-app) | P1 | ⬜ | — | Hint: notifier |
| A1.2.1.6 | `auto_post_on_approve` (true) | P1 | ⬜ | — | Hint: status flow |

### 2.2 Voucher Branding (7 items · P1)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.2.2.1 | `company_name` (from profile) | P1 | ⬜ | — | Hint: company table |
| A1.2.2.2 | `company_address` (from profile) | P1 | ⬜ | — | Hint: address fields |
| A1.2.2.3 | `tax_id` (from profile) | P1 | ⬜ | — | Hint: tax_id field |
| A1.2.2.4 | `logo_url` (uploaded) | P1 | ⬜ | — | Hint: assets |
| A1.2.2.5 | `theme_color` (#F87171) | P1 | ⬜ | — | Hint: theme config |
| A1.2.2.6 | `language` (th) | P1 | ⬜ | — | Hint: i18n |
| A1.2.2.7 | `show_qr_code` (true) | P1 | ⬜ | — | Hint: voucher template |

### 2.3 Display Preferences (6 items · P1)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.2.3.1 | `default_time_range` (this_month) | P1 | ⬜ | — | Hint: ListPage default |
| A1.2.3.2 | `pagination_size` (20) | P1 | ⬜ | — | Hint: table component |
| A1.2.3.3 | `date_format` (DD/MM/YYYY) | P1 | ⬜ | — | Hint: i18n |
| A1.2.3.4 | `decimal_places` (2) | P1 | ⬜ | — | Hint: formatter |
| A1.2.3.5 | `thousands_separator` (,) | P1 | ⬜ | — | Hint: formatter |
| A1.2.3.6 | `per_user_override` (true) | P1 | ⬜ | — | Hint: user_preferences |

### 2.4 Templates Management (5 items · P1)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.2.4.1 | `templates_enabled` (true) | P1 | ⬜ | — | Hint: feature flag |
| A1.2.4.2 | `max_templates_per_user` (50) | P1 | ⬜ | — | Hint: limit |
| A1.2.4.3 | `sharing_rules` (private) | P1 | ⬜ | — | Hint: ACL |
| A1.2.4.4 | `variables_support` (true) | P1 | ⬜ | — | Hint: template engine |
| A1.2.4.5 | `categories` (list) | P1 | ⬜ | — | Hint: category table |

### 2.5 Voucher Print Modes (3 items · P1 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.2.5.1 | `voucher_print_mode_default` (single) | P1 | ⬜ | — | Hint: VoucherPrintComponent |
| A1.2.5.2 | `voucher_include_adjustment` (false) | P1 | ⬜ | — | Hint: template |
| A1.2.5.3 | `voucher_show_partial_columns` (true) | P1 | ⬜ | — | Hint: partial display |

### 2.6 Date & Period Controls (4 items · P1 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.2.6.1 | `period_close_day` (31, สิ้นเดือน) | P1 | ⬜ | — | Hint: period logic |
| A1.2.6.2 | `period_grace_days` (5) | P1 | ⬜ | — | Hint: effective close date |
| A1.2.6.3 | `payment_date_warning_backdate` (30 days) | P1 | ⬜ | — | Hint: V19 warning |
| A1.2.6.4 | `payment_date_allow_future` (true) | P1 | ⬜ | — | Hint: scheduled payment |

### 2.7 Reverse Entry (4 items · P1 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.2.7.1 | `reverse_reason_required` (true) | P1 | ⬜ | — | Hint: form validation |
| A1.2.7.2 | `reverse_reasons_dropdown` (6 options) | P1 | ⬜ | — | Hint: enum/config |
| A1.2.7.3 | `reverse_manager_approval_days` (7) | P1 | ⬜ | — | Hint: approval trigger |
| A1.2.7.4 | `reverse_block_cascaded` (true) | P1 | ⬜ | — | Hint: child docs check |

### 2.8 Custom Income/Deduction (2 items · P1 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.2.8.1 | `custom_income_accounts_whitelist` (53-XXXX) | P1 | ⬜ | — | Hint: V17 implementation |
| A1.2.8.2 | `tax_exempt_warning_enabled` (true) | P1 | ⬜ | — | Hint: UI warning ม.42 |

### 3.1 Notifications (4 items · P2)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.3.1.1 | `draft_alerts_enabled` (true) | P2 | ⬜ | — | Hint: scheduled job |
| A1.3.1.2 | `ap_due_alerts` (true) | P2 | ⬜ | — | Hint: aging logic |
| A1.3.1.3 | `email_provider` (sendgrid) | P2 | ⬜ | — | Hint: config |
| A1.3.1.4 | `in_app_notifications` (true) | P2 | ⬜ | — | Hint: notification table |

### 3.2 User Permissions RBAC (4 items · P2)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.3.2.1 | `roles_defined` (Owner/Manager/Accountant/Viewer) | P2 | ⬜ | — | Hint: roles table |
| A1.3.2.2 | `settings_access_role` (Owner only) | P2 | ⬜ | — | Hint: ACL |
| A1.3.2.3 | `post_permission` (role-based) | P2 | ⬜ | — | Hint: middleware |
| A1.3.2.4 | `reverse_permission` (Manager+) | P2 | ⬜ | — | Hint: middleware |

### 3.3 Integration (4 items · P2)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.3.3.1 | `export_enabled` (CSV+Excel+PDF) | P2 | ⬜ | — | Hint: export endpoints |
| A1.3.3.2 | `bank_reconciliation` (manual) | P2 | ⬜ | — | Hint: recon module |
| A1.3.3.3 | `webhooks` (disabled) | P2 | ⬜ | — | Hint: webhook config |
| A1.3.3.4 | `api_keys` (admin only) | P2 | ⬜ | — | Hint: API key management |

### 3.4 Smart Switch (2 items · P2 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.3.4.1 | `smart_doctype_switch_enabled` (true) | P2 | ⬜ | — | Hint: EntryPage logic |
| A1.3.4.2 | `smart_switch_threshold_days` (0) | P2 | ⬜ | — | Hint: trigger condition |

### 3.5 Expense Summary (3 items · P2 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.3.5.1 | `summary_default_range` (today) | P2 | ⬜ | — | Hint: ExpenseSummary default |
| A1.3.5.2 | `summary_all_range_warning` (true) | P2 | ⬜ | — | Hint: warning UI |
| A1.3.5.3 | `summary_pagination_size` (50) | P2 | ⬜ | — | Hint: pagination |

### 3.6 Multi-bill Picker (3 items · P2 · NEW v2.0)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.3.6.1 | `settlement_max_bills_per_doc` (100) | P2 | ⬜ | — | Hint: V12 limit |
| A1.3.6.2 | `settlement_default_tick_behavior` (none) | P2 | ⬜ | — | Hint: UI default |
| A1.3.6.3 | `settlement_partial_payment_enabled` (true) | P2 | ⬜ | — | Hint: partial logic |

### 4.1 UI & UX Defaults (4 items · P3)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.4.1.1 | `sidebar_collapsed` (false) | P3 | ⬜ | — | preference per user |
| A1.4.1.2 | `show_keyboard_shortcuts` (true) | P3 | ⬜ | — | help tooltip |
| A1.4.1.3 | `animation_enabled` (true) | P3 | ⬜ | — | accessibility |
| A1.4.1.4 | `dark_mode` (true) | P3 | ⬜ | — | default theme |

### 4.2 Performance Tuning (5 items · P3)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.4.2.1 | `query_timeout_seconds` (30) | P3 | ⬜ | — | long-running queries |
| A1.4.2.2 | `cache_ttl_dashboard` (60s) | P3 | ⬜ | — | dashboard counts |
| A1.4.2.3 | `cache_ttl_reports` (300s) | P3 | ⬜ | — | aggregated reports |
| A1.4.2.4 | `batch_size_import` (500) | P3 | ⬜ | — | CSV import |
| A1.4.2.5 | `max_concurrent_jobs` (5) | P3 | ⬜ | — | background queue |

### 4.3 Audit & Compliance (6 items · P3)

| ID | Item | Priority | Status | PR | Evidence/Notes |
|---|---|---|---|---|---|
| A1.4.3.1 | `audit_log_retention_days` (1825 = 5 ปี) | P3 | ⬜ | — | พ.ร.บ.บัญชี ม.7 |
| A1.4.3.2 | `audit_log_archive` (enabled) | P3 | ⬜ | — | archive ก่อนลบ |
| A1.4.3.3 | `document_retention_years` (5) | P3 | ⬜ | — | กฎหมายไทย |
| A1.4.3.4 | `data_export_format` (JSON) | P3 | ⬜ | — | compliance backup |
| A1.4.3.5 | `pii_masking` (enabled) | P3 | ⬜ | — | PDPA |
| A1.4.3.6 | `login_log` (enabled) | P3 | ⬜ | — | security |

## Item count verification

- 1.1–1.6 (P0): 7+5+6+4+5+3 = **30** ✓
- 2.1–2.8 (P1): 6+7+6+5+3+4+4+2 = **37** ✓
- 3.1–3.6 (P2): 4+4+4+2+3+3 = **20** ✓
- 4.1–4.3 (P3): 4+5+6 = **15** ✓
- **Total: 102** ✓

## Decision Log

(empty — fills during audit)

## Open Questions

(empty — fills during audit)

## Dependencies

- ✅ T0 (tracking infrastructure exists)
- A0 should complete first (Pre-flight Verify) so audit doesn't include stale data
- After Phase 2 reports, owner approves scope → D1 (Phase 4) begins
