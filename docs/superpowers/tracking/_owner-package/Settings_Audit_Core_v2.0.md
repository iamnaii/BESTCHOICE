# Settings Audit · Core v2.0

> **Transcribed from `Settings_Audit_Core_v2.0.pdf` (12 pages) on 2026-05-16.**
> Original PDF in 2026-05-16 conversation history.

**Business Expense Module — Task Brief for AI Coding Agent**
**BESTCHOICE FINANCE × SHOP**
**15 พฤษภาคม 2569**

⚠ **อ่าน `Settings_Audit_Index.md` ก่อนเสมอ**

---

## 📋 Overview

เอกสารนี้คือ task brief สำหรับ AI Coding Agent ที่จะตรวจสอบ Settings ทั้งหมดในระบบค่าใช้จ่าย — Settings Audit v2.0

## 🎯 Mission — 4 Phases

- **Phase 1 · AUDIT** — ตรวจ codebase ตาม Detection Hint แต่ละ item, mark ✅/❌/◐
- **Phase 2 · REPORT** — สรุปผลใน markdown table + file paths
- **Phase 3 · WAIT** — รอ Owner approve scope (⚠ ห้าม implement ทันที)
- **Phase 4 · IMPLEMENT** — เฉพาะ items ที่ approve + unit tests + migration script

## 📊 102 Items แยกตาม Priority

| Priority | Count | คำอธิบาย | เวลา |
|---|---|---|---|
| **P0 · Critical** | 30 | ต้องมีก่อน production · กระทบ business logic + กฎหมาย | ก่อนปิดงวด พ.ค. 69 |
| **P1 · High** | 37 | ต้องมีเพื่อใช้งานจริง · กระทบ UX | Sprint นี้ |
| **P2 · Medium** | 20 | nice to have · เพิ่มประสิทธิภาพ | Sprint ถัดไป |
| **P3 · Configuration** | 15 | ค่า default ที่ tune ได้ | เมื่อต้องการ |
| **รวม** | **102** | | |

---

## 🔴 P0 · Critical Settings (30 items)

ต้องมีก่อน production · กระทบ business logic + กฎหมาย

### 1.1 Account Role Map (7 items)

*Existing from v1.0 — บัญชีที่ระบบใช้ทำ JE auto*

| # | Setting | Default | Detection Hint |
|---|---|---|---|
| 1.1.1 | DB table: account_role_map | - | ตรวจ migration files + schema |
| 1.1.2 | GET /api/settings/role-map | - | ตรวจ controller |
| 1.1.3 | PUT /api/settings/role-map | - | ตรวจ controller |
| 1.1.4 | Admin UI for role map | - | ตรวจ React component |
| 1.1.5 | Validation rules | - | ตรวจ validator |
| 1.1.6 | Audit log on change | - | ตรวจ audit table |
| 1.1.7 | Permission control | Admin only | ตรวจ middleware |

### 1.2 Document Numbering (5 items)

*Existing from v1.0*

| # | Setting | Default | Detection Hint |
|---|---|---|---|
| 1.2.1 | doc_prefix_per_type | EXP/SET/PAY/CN/PC | enum DocType |
| 1.2.2 | doc_number_format | YYMMNNN | ตรวจ doc generator |
| 1.2.3 | reset_cycle | yearly | ตรวจ sequence reset logic |
| 1.2.4 | sequence_table | doc_sequences | ตรวจ schema |
| 1.2.5 | admin_reset_capability | true | ตรวจ admin route |

### 1.3 Tax Rates (6 items)

*Existing + Updated — แก้ SSO ตาม 1.4*

| # | Setting | Default | Detection Hint |
|---|---|---|---|
| 1.3.1 | vat_rate | 7% | ตรวจ tax_rates table |
| 1.3.2 | wht_rates | 1/3/5/10/15 | ตรวจ wht_rate enum |
| 1.3.3 | sso_rate | 5% | ตรวจ payroll calculator |
| 1.3.4 | sso_max (REFINED → 1.4) | 875 บ (ปี 2569) | ดู 1.4 |
| 1.3.5 | effective_date support | required | ตรวจ schema มี effective_from |
| 1.3.6 | Admin UI | - | ตรวจ /settings/tax-rates |

### 🆕 1.4 SSO Configurable (4 items) — NEW v2.0

**Rationale:** SSO เพดานเปลี่ยน 1 ม.ค. 2569 ตามกฎกระทรวง · ต้องรองรับการเปลี่ยนทุก 3 ปี

| # | Setting | Default (2569) | Detection Hint |
|---|---|---|---|
| 1.4.1 | sso_salary_ceiling | 17,500 บ | ค้นหา `15000` hard-coded → ❌ |
| 1.4.2 | sso_max_contribution | 875 บ | ค้นหา `750` hard-coded → ❌ |
| 1.4.3 | sso_effective_from/to | 01/01/69 — 31/12/71 | ตรวจ schema |
| 1.4.4 | Stepped ceiling support | true | ตรวจ historical query |

⚠ **Hard-coded values ตรวจหาใน:** `apps/api/src/modules/payroll/calculator.ts`, `payroll.service.ts`

### 🆕 1.5 Petty Cash (5 items) — NEW v2.0

**Rationale:** มาตรฐานบัญชีไทยใช้ Petty Cash จัดการเงินสดเล็กๆ ที่มีหลาย supplier ในวันเดียว

| # | Setting | Default | Detection Hint |
|---|---|---|---|
| 1.5.1 | petty_cash_enabled | true | ตรวจ feature flag |
| 1.5.2 | petty_cash_account | 11-1103 | ตรวจ CoA |
| 1.5.3 | petty_cash_limit | 5,000 บ | ตรวจ V20 implementation |
| 1.5.4 | petty_cash_replenish_threshold | 1,000 บ | ตรวจ alert logic |
| 1.5.5 | petty_cash_custodian | (employee FK) | ตรวจ user assignment |

⚠ **ต้องเพิ่ม doc_type `PETTY_CASH_REIMBURSEMENT` + V20 validator**

### 🆕 1.6 Adjustment Routing (3 items) — NEW v2.0

**Rationale:** Action #1 fix — ใช้บัญชี 52-1104 (underpay) ไม่ใช่ 53-1503

| # | Setting | Default | Detection Hint |
|---|---|---|---|
| 1.6.1 | adj_underpay_account | 52-1104 | ตรวจ `getDefaultAdjustmentAccount()` |
| 1.6.2 | adj_overpay_account | 53-1503 | ตรวจ direction handling |
| 1.6.3 | adj_auto_route | true | ตรวจ auto-route logic |

⚠ **Action #1 ใน `Dev_Action_Items.md` ต้อง verify ว่า fix แล้ว**

---

## 🟠 P1 · High Priority Settings (37 items)

ต้องมีเพื่อใช้งานจริง · กระทบ UX

### 2.1 Approval Workflow (6 items)

*Existing from v1.0*

| # | Setting | Default | Detection Hint |
|---|---|---|---|
| 2.1.1 | approval_enabled | true | feature flag |
| 2.1.2 | approval_threshold | 50,000 บ | ตรวจ amount check |
| 2.1.3 | approvers_list | (user IDs) | ตรวจ approvers table |
| 2.1.4 | approval_required_doc_types | [PAYROLL] | enum check |
| 2.1.5 | notification_on_pending | email + in-app | ตรวจ notifier |
| 2.1.6 | auto_post_on_approve | true | ตรวจ status flow |

### 2.2 Voucher Branding (7 items)

*Existing from v1.0*

| # | Setting | Default | Detection Hint |
|---|---|---|---|
| 2.2.1 | company_name | (from profile) | ตรวจ company table |
| 2.2.2 | company_address | (from profile) | ตรวจ address fields |
| 2.2.3 | tax_id | (from profile) | ตรวจ tax_id field |
| 2.2.4 | logo_url | (uploaded) | ตรวจ assets |
| 2.2.5 | theme_color | #F87171 | ตรวจ theme config |
| 2.2.6 | language | th | ตรวจ i18n |
| 2.2.7 | show_qr_code | true | ตรวจ voucher template |

### 2.3 Display Preferences (6 items)

*Existing from v1.0*

| # | Setting | Default | Detection Hint |
|---|---|---|---|
| 2.3.1 | default_time_range | this_month | ตรวจ ListPage default |
| 2.3.2 | pagination_size | 20 | ตรวจ table component |
| 2.3.3 | date_format | DD/MM/YYYY | ตรวจ i18n |
| 2.3.4 | decimal_places | 2 | ตรวจ formatter |
| 2.3.5 | thousands_separator | , | ตรวจ formatter |
| 2.3.6 | per_user_override | true | ตรวจ user_preferences |

### 2.4 Templates Management (5 items)

*Existing from v1.0*

| # | Setting | Default | Detection Hint |
|---|---|---|---|
| 2.4.1 | templates_enabled | true | feature flag |
| 2.4.2 | max_templates_per_user | 50 | ตรวจ limit |
| 2.4.3 | sharing_rules | private | ตรวจ ACL |
| 2.4.4 | variables_support | true | ตรวจ template engine |
| 2.4.5 | categories | (list) | ตรวจ category table |

### 🆕 2.5 Voucher Print Modes (3 items) — NEW v2.0

**Rationale:** SETTLEMENT หลายบิล · User เลือก mode ตอนพิมพ์

| # | Setting | Default | Detection Hint |
|---|---|---|---|
| 2.5.1 | voucher_print_mode_default | single | ตรวจ VoucherPrintComponent |
| 2.5.2 | voucher_include_adjustment | false | ตรวจ template |
| 2.5.3 | voucher_show_partial_columns | true | ตรวจ partial display |

**Mode options:** single (1 หน้า) · multi (cover + แนบใบเดิม) · select (เลือกบิล)

### 🆕 2.6 Date & Period Controls (4 items) — NEW v2.0

**Rationale:** V19 (วันที่จ่าย ≤ วันปิดงวด) + grace period support

| # | Setting | Default | Detection Hint |
|---|---|---|---|
| 2.6.1 | period_close_day | 31 (สิ้นเดือน) | ตรวจ period logic |
| 2.6.2 | period_grace_days | 5 | ตรวจ effective close date |
| 2.6.3 | payment_date_warning_backdate | 30 days | ตรวจ V19 warning |
| 2.6.4 | payment_date_allow_future | true | ตรวจ scheduled payment |

### 🆕 2.7 Reverse Entry (4 items) — NEW v2.0

**Rationale:** Reverse Dialog · เหตุผลจำเป็น · cascade check

| # | Setting | Default | Detection Hint |
|---|---|---|---|
| 2.7.1 | reverse_reason_required | true | ตรวจ form validation |
| 2.7.2 | reverse_reasons_dropdown | (6 options) | ตรวจ enum/config |
| 2.7.3 | reverse_manager_approval_days | 7 | ตรวจ approval trigger |
| 2.7.4 | reverse_block_cascaded | true | ตรวจ child docs check |

**Reasons:** ลงบัญชีผิด · ผู้ขายผิด · ยกเลิกการซื้อ · คำนวณ VAT/WHT ผิด · จำนวนเงินผิด · อื่นๆ

### 🆕 2.8 Custom Income/Deduction (2 items) — NEW v2.0

**Rationale:** PAYROLL Custom · V17, V18 enforcement

| # | Setting | Default | Detection Hint |
|---|---|---|---|
| 2.8.1 | custom_income_accounts_whitelist | 53-XXXX (Expense) | ตรวจ V17 implementation |
| 2.8.2 | tax_exempt_warning_enabled | true | ตรวจ UI warning ม.42 |

---

## 🔵 P2 · Medium Priority Settings (20 items)

### 3.1 Notifications (4 items)

*Existing from v1.0*

| # | Setting | Default | Detection Hint |
|---|---|---|---|
| 3.1.1 | draft_alerts_enabled | true | ตรวจ scheduled job |
| 3.1.2 | ap_due_alerts | true | ตรวจ aging logic |
| 3.1.3 | email_provider | sendgrid | ตรวจ config |
| 3.1.4 | in_app_notifications | true | ตรวจ notification table |

### 3.2 User Permissions RBAC (4 items)

*Existing from v1.0 — basic*

| # | Setting | Default | Detection Hint |
|---|---|---|---|
| 3.2.1 | roles_defined | (Owner/Manager/Accountant/Viewer) | ตรวจ roles table |
| 3.2.2 | settings_access_role | Owner only | ตรวจ ACL |
| 3.2.3 | post_permission | role-based | ตรวจ middleware |
| 3.2.4 | reverse_permission | Manager+ | ตรวจ middleware |

### 3.3 Integration (4 items)

*Existing from v1.0*

| # | Setting | Default | Detection Hint |
|---|---|---|---|
| 3.3.1 | export_enabled | CSV+Excel+PDF | ตรวจ export endpoints |
| 3.3.2 | bank_reconciliation | manual | ตรวจ recon module |
| 3.3.3 | webhooks | disabled | ตรวจ webhook config |
| 3.3.4 | api_keys | admin only | ตรวจ API key management |

### 🆕 3.4 Smart Switch (2 items) — NEW v2.0

**Rationale:** SAMEDAY ↔ ACCRUAL auto-switch ตาม invoice_date

| # | Setting | Default | Detection Hint |
|---|---|---|---|
| 3.4.1 | smart_doctype_switch_enabled | true | ตรวจ EntryPage logic |
| 3.4.2 | smart_switch_threshold_days | 0 | ตรวจ trigger condition |

### 🆕 3.5 Expense Summary (3 items) — NEW v2.0

**Rationale:** DailySheet → ExpenseSummary rename + chip-style date range

| # | Setting | Default | Detection Hint |
|---|---|---|---|
| 3.5.1 | summary_default_range | today | ตรวจ ExpenseSummary default |
| 3.5.2 | summary_all_range_warning | true | ตรวจ warning UI |
| 3.5.3 | summary_pagination_size | 50 | ตรวจ pagination |

### 🆕 3.6 Multi-bill Picker (3 items) — NEW v2.0

**Rationale:** SETTLEMENT Pattern C — Multi-bill + Partial payment

| # | Setting | Default | Detection Hint |
|---|---|---|---|
| 3.6.1 | settlement_max_bills_per_doc | 100 | ตรวจ V12 limit |
| 3.6.2 | settlement_default_tick_behavior | none | ตรวจ UI default |
| 3.6.3 | settlement_partial_payment_enabled | true | ตรวจ partial logic |

---

## ⚪ P3 · Configuration Defaults (15 items)

ค่า default ที่ tune ได้ทีหลัง · ไม่ critical

### 4.1 UI & UX Defaults

| # | Setting | Default | หมายเหตุ |
|---|---|---|---|
| 4.1.1 | sidebar_collapsed | false | preference per user |
| 4.1.2 | show_keyboard_shortcuts | true | help tooltip |
| 4.1.3 | animation_enabled | true | accessibility |
| 4.1.4 | dark_mode | true | default theme |

### 4.2 Performance Tuning

| # | Setting | Default | หมายเหตุ |
|---|---|---|---|
| 4.2.1 | query_timeout_seconds | 30 | long-running queries |
| 4.2.2 | cache_ttl_dashboard | 60 seconds | dashboard counts |
| 4.2.3 | cache_ttl_reports | 300 seconds | aggregated reports |
| 4.2.4 | batch_size_import | 500 | CSV import |
| 4.2.5 | max_concurrent_jobs | 5 | background queue |

### 4.3 Audit & Compliance

| # | Setting | Default | หมายเหตุ |
|---|---|---|---|
| 4.3.1 | audit_log_retention_days | 1825 (5 ปี) | ตาม พ.ร.บ.บัญชี ม.7 |
| 4.3.2 | audit_log_archive | enabled | archive ก่อนลบ |
| 4.3.3 | document_retention_years | 5 | กฎหมายไทย |
| 4.3.4 | data_export_format | JSON | compliance backup |
| 4.3.5 | pii_masking | enabled | PDPA |
| 4.3.6 | login_log | enabled | security |

---

## 📋 Implementation Notes for AI Dev

### Phase 1: AUDIT Methodology

ทำตามลำดับนี้ทุก item:

- อ่าน Detection Hint
- Search codebase ด้วย keywords ที่ระบุ
- ตรวจไฟล์ใน path ที่เกี่ยวข้อง
- Mark status: ✅ มีอยู่ครบ · ❌ ไม่มี · ◐ มีบางส่วน
- Note evidence (file path + line number)

### Phase 2: REPORT Format

```
| # | Priority | Setting | Status | Evidence | Action |
|---|----------|---------|--------|----------|--------|
| 1.4.1 | P0 | sso_salary_ceiling | ❌ | src/payroll/calc.ts:42 (hard-coded 15000) | ต้องเพิ่ม Settings + migrate |
| 1.1.1 | P0 | account_role_map table | ✅ | migrations/001_initial.sql | - |
```

### Phase 3: WAIT FOR APPROVAL

**Owner จะใช้ Decision Framework:**

- ✅ APPROVE: P0 ≥80% missing + P1 ≥50% missing → ทำเลย
- ◐ DEFER: P0 ≥50% missing แต่ P1 <50% → ทำ P0 ก่อน
- ⏸ SKIP: P0 <50% missing → ระบบมีแล้ว ไม่ต้องเพิ่ม

### Phase 4: IMPLEMENT Requirements

- Unit tests coverage ≥ 80% per new module
- Migration script + rollback script
- Update API documentation
- Update Implementation Review (Dev marks items DONE)

---

## 📁 Quick Reference: Files to Inspect

### Backend (`apps/api/`)

```
src/modules/
├── settings/                ← Settings table + API
├── payroll/                 ← SSO calculator (1.4 critical)
│   ├── calculator.ts        ← Find hard-coded 750, 15000
│   └── service.ts
├── expense/
│   ├── validator.ts         ← V1-V20 rules
│   ├── settlement.ts        ← Multi-bill (2.5, 3.6)
│   └── adjustment.ts        ← Action #1 fix (1.6)
├── voucher/
│   └── print.ts             ← Print modes (2.5)
└── audit/
    └── log.ts               ← V19, V20 logs
```

### Frontend (`apps/web/`)

```
src/pages/
├── expenses/
│   ├── list.tsx             ← Time range (2.3.1)
│   ├── new.tsx              ← Smart switch (3.4)
│   ├── settlement-form.tsx  ← Multi-bill picker (3.6)
│   ├── payroll-form.tsx     ← Custom income (2.8)
│   └── summary.tsx          ← ExpenseSummary (3.5)
├── settings/
│   ├── tax-rates.tsx        ← SSO config (1.4)
│   ├── petty-cash.tsx       ← Petty Cash setup (1.5)
│   └── roles.tsx            ← Adjustment routing (1.6)
└── components/
    ├── voucher-print.tsx    ← Print modes (2.5)
    └── reverse-dialog.tsx   ← Reverse Entry (2.7)
```

---

## 📞 Communication

ระหว่าง audit:

- ถ้าพบ ambiguous spec → ถาม Owner ก่อน implement
- ถ้าพบ conflict กับ codebase → flag ใน report
- ถ้าพบ bug ระหว่าง audit → log แยก ไม่รวมกับ settings work

---

**━━━ END OF SETTINGS AUDIT CORE v2.0 ━━━**

BESTCHOICE FINANCE × SHOP · 15 พฤษภาคม 2569
