# 🧭 Settings Audit v2.0 · Index

**BESTCHOICE FINANCE × SHOP**
**Business Expense Module — Settings Audit Task Brief**
**Version 2.0** · 15 พ.ค. 2569

---

## 📄 อ่านไฟล์ไหนก่อน?

ไฟล์นี้คือ **entry point** สำหรับ Dev/AI Coding Agent ที่จะตรวจสอบ Settings ในระบบค่าใช้จ่าย

### 📦 มี 3 ไฟล์ทั้งหมด:

| ไฟล์ | สำหรับ | เนื้อหา |
|------|--------|---------|
| **`Settings_Audit_Index.md`** (ไฟล์นี้) | ทุกคนอ่านก่อน | Overview · 102 items · Decision Framework |
| **`Settings_Audit_Core_v2.0.docx`** | AI Dev ใช้ตรวจ codebase | Spec ฉบับสมบูรณ์ทุก item + Detection Hint |
| **`Settings_Audit_Change_Log.md`** | Owner + Dev ที่เคยอ่าน v1.0 | บอกว่าอะไรเปลี่ยนจาก v1.0 → v2.0 |

---

## 🎯 Mission — 4 Phases

```
Phase 1 · AUDIT     → ตรวจ codebase ตาม Detection Hint, mark ✅/❌/◐
Phase 2 · REPORT    → สรุปผลใน markdown table + file paths
Phase 3 · WAIT      → รอ Owner approve scope (⚠ ห้าม implement ทันที)
Phase 4 · IMPLEMENT → เฉพาะ items ที่ approve + unit tests + migration script
```

---

## 📊 สรุป 102 Items แยกตาม Priority

| Priority | Count | คำอธิบาย | เวลา |
|----------|-------|----------|------|
| **P0 · Critical** | **30** | ต้องมีก่อน production · กระทบ business logic + กฎหมาย | ก่อนปิดงวด พ.ค. 69 |
| **P1 · High** | **37** | ต้องมีเพื่อใช้งานจริง · กระทบ UX | Sprint นี้ |
| **P2 · Medium** | **20** | nice to have · เพิ่มประสิทธิภาพ | Sprint ถัดไป |
| **P3 · Configuration** | **15** | ค่า default ที่ tune ได้ | เมื่อต้องการ |
| **รวม** | **102** | | |

### เปลี่ยนจาก v1.0 → v2.0:
- v1.0 (เดิม): **52 items**
- v2.0 (ใหม่): **102 items** (เพิ่ม **50 items** — ดูรายละเอียดใน Change Log)

---

## 🔴 P0 · Critical Settings (30 items)

### 1.1 Account Role Map (7 items) — เดิม
- Database table for account roles
- GET/PUT API endpoints
- Admin UI to edit
- Validation rules
- Audit log
- Permission control
- Migration script

### 1.2 Document Numbering (5 items) — เดิม
- Prefix configurable
- Format (YYMMNNN)
- Reset cycle (yearly/monthly/never)
- Sequence number
- Admin reset capability

### 1.3 Tax Rates (6 items) — เดิม
- VAT rate (7%)
- WHT rates (1%/3%/5%/10%/15%)
- SSO rate (5%)
- SSO ceiling (875 บ ปี 2569)
- Effective date support
- Admin UI

### 🆕 1.4 SSO Configurable (4 items) — **NEW v2.0**
- `sso_salary_ceiling` (default: 17,500 บ ปี 2569)
- `sso_max_contribution` (default: 875 บ)
- `sso_effective_from` / `sso_effective_to`
- Stepped ceiling support (2569 → 2572 → 2575)

### 🆕 1.5 Petty Cash (5 items) — **NEW v2.0**
- `petty_cash_enabled` (boolean)
- `petty_cash_account` (default: 11-1103)
- `petty_cash_limit` (default: 5,000 บ)
- `petty_cash_replenish_threshold` (default: 1,000 บ)
- `petty_cash_custodian` (employee FK)

### 🆕 1.6 Adjustment Routing (3 items) — **NEW v2.0**
- `adj_underpay_account` (default: 52-1104)
- `adj_overpay_account` (default: 53-1503)
- `adj_auto_route` (boolean, true)

---

## 🟠 P1 · High Priority Settings (37 items)

### 2.1 Approval Workflow (6 items) — เดิม
- Enable approval workflow
- Threshold amount
- Approvers list
- Notification

### 2.2 Voucher Branding (7 items) — เดิม
- Company name, address, tax ID
- Logo upload
- Theme color
- Language

### 2.3 Display Preferences (6 items) — เดิม
- Default time range
- Pagination size
- Date format
- Decimal places
- Per-user override

### 2.4 Templates Management (5 items) — เดิม
- Enable templates
- Max limit per user
- Sharing rules
- Variables
- Categories

### 🆕 2.5 Voucher Print Modes (3 items) — **NEW v2.0**
- `voucher_print_mode_default` (single/multi/select)
- `voucher_include_adjustment` (boolean, false)
- `voucher_show_partial_columns` (boolean, true)

### 🆕 2.6 Date & Period Controls (4 items) — **NEW v2.0**
- `period_close_day` (default: end of month)
- `period_grace_days` (default: 5)
- `payment_date_warning_backdate` (default: 30 days)
- `payment_date_allow_future` (boolean, true)

### 🆕 2.7 Reverse Entry (4 items) — **NEW v2.0**
- `reverse_reason_required` (boolean, true)
- `reverse_reasons_dropdown` (list of 6)
- `reverse_manager_approval_days` (default: 7)
- `reverse_block_cascaded` (boolean, true)

### 🆕 2.8 Custom Income/Deduction (2 items) — **NEW v2.0**
- `custom_income_accounts_whitelist` (53-XXXX list)
- `tax_exempt_warning_enabled` (boolean, true)

---

## 🔵 P2 · Medium Priority Settings (20 items)

### 3.1 Notifications (4 items) — เดิม
### 3.2 User Permissions RBAC (4 items) — เดิม
### 3.3 Integration (4 items) — เดิม

### 🆕 3.4 Smart Switch (2 items) — **NEW v2.0**
- `smart_doctype_switch_enabled` (boolean, true)
- `smart_switch_threshold_days` (default: 0)

### 🆕 3.5 Expense Summary (3 items) — **NEW v2.0**
- `summary_default_range` (today/this_month/last_month)
- `summary_all_range_warning` (boolean, true)
- `summary_pagination_size` (default: 50)

### 🆕 3.6 Multi-bill Picker (3 items) — **NEW v2.0**
- `settlement_max_bills_per_doc` (default: 100)
- `settlement_default_tick_behavior` (none/all/overdue)
- `settlement_partial_payment_enabled` (boolean, true)

---

## ⚪ P3 · Configuration Defaults (15 items) — **NEW v2.0**

Settings ที่ใช้เป็นค่า default ที่ tune ได้ทีหลัง · ไม่ critical

(รายละเอียดในใน Core v2.0)

---

## 🎯 Decision Framework สำหรับ Owner

หลังจาก AI Dev รัน Phase 1+2 แล้ว Owner ใช้ framework ที่ตัดสินใจ approve scope:

```
✅ APPROVE: ถ้า P0 ≥80% missing + P1 ≥50% missing
◐ DEFER:   ถ้า P0 ≥50% missing แต่ P1 <50% (ทำ P0 ก่อน, P1 รอ Sprint หน้า)
⏸ SKIP:    ถ้า P0 <50% missing (ระบบมีแล้วในระดับใต้พอใจ)
```

### หลังจาก approve scope แล้ว:
1. AI Dev เริ่ม Phase 4 (Implement)
2. ทุก item ต้องมี:
   - Unit tests (coverage ≥ 80%)
   - Migration script (ถ้ามี DB change)
   - Update Implementation spec
3. Owner review code + approve PR

---

## ⚠ ข้อสำคัญสำหรับ AI Dev

- **ห้าม implement ทันที** โดยไม่ตรวจก่อน
- **ห้ามทำของที่มีอยู่แล้วซ้ำ** — ใช้ Detection Hint จริงๆ
- **รายงาน Owner ก่อนเริ่มทำเพิ่ม** — ทุก item ต้องผ่าน Phase 3
- **ใช้ Detection Hint** ที่ระบุใน Core เป็น minimum coverage

---

## 📎 ไฟล์ที่เกี่ยวข้อง

- `Business_Expense_Module_Dev_Action_Items.docx` — Bug Fix v1.0 (5 actions)
- `Business_Expense_Module_Developer_Spec_v2_2.docx` — UX Update v2.2
- `expense_module_mockup_v5.html` — Mockup สมบูรณ์ (11 หน้า)
- `Implementation_Review_Business_Expense_v1.0.pdf` — Review สำหรับ Owner
- `Business_Expense_Module_Settings_Audit_AI_Dev.docx` (v1.0 — **deprecated** ใช้ v2.0 แทน)

---

**END OF INDEX · เริ่มอ่าน Settings_Audit_Core_v2.0.docx ต่อ**
