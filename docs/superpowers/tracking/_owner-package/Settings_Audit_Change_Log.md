# 📋 Settings Audit · Change Log v1.0 → v2.0

**BESTCHOICE FINANCE × SHOP**
**Business Expense Module — Settings Audit**
**Updated: 15 พ.ค. 2569**

---

## 🎯 Why v2.0?

หลังจาก v1.0 (ที่มี 52 items) เราคุยเพิ่มอีกหลายรอบและพบว่า:
1. **กฎหมายเปลี่ยน** — SSO เพดานใหม่ปี 2569 (875 บ)
2. **มี doc_type ใหม่** — Petty Cash Reimbursement
3. **มี feature ใหม่** — Multi-bill Picker, Custom Income, etc.
4. **มี V-rules ใหม่** — V16-V20

ทำให้ต้องเพิ่ม Settings **50 items** เพื่อให้ Dev configure ค่าทั้งหมดได้

---

## 📊 สรุปการเปลี่ยนแปลง

```
v1.0:  52 items  (P0:18, P1:22, P2:12)
v2.0: 102 items  (P0:30, P1:37, P2:20, P3:15)
       ────────────────────────────────────────────
       +50 items   +12 P0, +15 P1, +8 P2, +15 P3
```

---

## 🆕 รายการ Settings ใหม่ทั้ง 50 items

### 1.4 SSO Configurable (4 items) — **P0**
> **Rationale:** SSO เพดานเปลี่ยน 1 ม.ค. 2569 ตามกฎกระทรวง · ต้องรองรับการเปลี่ยนทุก 3 ปี

| # | Setting | Default (2569) | Type |
|---|---------|----------------|------|
| 1.4.1 | `sso_salary_ceiling` | 17,500 บ | Decimal |
| 1.4.2 | `sso_max_contribution` | 875 บ | Decimal |
| 1.4.3 | `sso_effective_from` / `sso_effective_to` | 01/01/2569 — 31/12/2571 | Date range |
| 1.4.4 | Stepped ceiling support | Yes | Boolean |

**Detection Hint:**
- ค้นหา `750` ในใน codebase → ถ้ามี hard-coded ในใน `apps/api/src/modules/payroll/calculator.ts` → ❌ ต้องแก้ใช้
- ค้นหา `15000` ในใน expense calculator → ถ้ามี hard-coded → ❌ ต้องแก้ใช้
- ตรวจ table `tax_rates` ถ้ามี → ❌ คือการมีแล้ว

---

### 1.5 Petty Cash (5 items) — **P0**
> **Rationale:** มาตรฐานบัญชีไทยใช้ Petty Cash จัดการเงินสดเล็กๆ ที่มีหลาย supplier ในวันเดียว

| # | Setting | Default | Type |
|---|---------|---------|------|
| 1.5.1 | `petty_cash_enabled` | true | Boolean |
| 1.5.2 | `petty_cash_account` | 11-1103 | Account code |
| 1.5.3 | `petty_cash_limit` | 5,000 บ | Decimal |
| 1.5.4 | `petty_cash_replenish_threshold` | 1,000 บ | Decimal |
| 1.5.5 | `petty_cash_custodian` | (employee ID) | FK |

**Detection Hint:**
- ค้นหา `doc_type` enum → ถ้าไม่มี `PETTY_CASH_REIMBURSEMENT` → ❌ ต้องเพิ่ม
- ตรวจ schema EXP table มี column `supplier_per_line` ไหม → ถ้าไม่มี → ❌
- ตรวจ V20 ในใน `validator.ts` → ถ้าไม่มี → ❌

---

### 1.6 Adjustment Routing (3 items) — **P0**
> **Rationale:** Action #1 fix · ใช้บัญชี 52-1104 (underpay) ไม่ใช่ 53-1503

| # | Setting | Default | Type |
|---|---------|---------|------|
| 1.6.1 | `adj_underpay_account` | 52-1104 | Account code |
| 1.6.2 | `adj_overpay_account` | 53-1503 | Account code |
| 1.6.3 | `adj_auto_route` | true | Boolean |

**Detection Hint:**
- ค้นหา `getDefaultAdjustmentAccount()` หรือคล้ายๆ ในใน frontend
- ถ้า hard-code `'53-1503'` ทั้ง 2 direction → ❌ Action #1 ยังไม่ fix

---

### 2.5 Voucher Print Modes (3 items) — **P1**
> **Rationale:** SETTLEMENT หลายบิล · User เลือกใช้โดยพิมพ์

| # | Setting | Default | Type |
|---|---------|---------|------|
| 2.5.1 | `voucher_print_mode_default` | single | Enum (single/multi/select) |
| 2.5.2 | `voucher_include_adjustment` | false | Boolean |
| 2.5.3 | `voucher_show_partial_columns` | true | Boolean |

**Detection Hint:**
- ตรวจ `VoucherPrintComponent` มี mode selector ใหม่
- ถ้ามีแต่ "พิมพ์ A4" ปุ่มเดียว → ❌ ต้องเพิ่ม dropdown

---

### 2.6 Date & Period Controls (4 items) — **P1**
> **Rationale:** V19 (วันที่จ่าย ≤ วันปิดงวด) · รองรับ grace period

| # | Setting | Default | Type |
|---|---------|---------|------|
| 2.6.1 | `period_close_day` | 31 (สิ้นเดือน) | Integer |
| 2.6.2 | `period_grace_days` | 5 | Integer |
| 2.6.3 | `payment_date_warning_backdate` | 30 | Integer (days) |
| 2.6.4 | `payment_date_allow_future` | true | Boolean |

**Detection Hint:**
- ค้นหา `validatePaymentDate()` ในใน validator.ts
- ตรวจ V19 implementation
- ถ้าไม่มี → ❌

---

### 2.7 Reverse Entry (4 items) — **P1**
> **Rationale:** Reverse Dialog · เหตุผลจำเป็น · cascade check

| # | Setting | Default | Type |
|---|---------|---------|------|
| 2.7.1 | `reverse_reason_required` | true | Boolean |
| 2.7.2 | `reverse_reasons_dropdown` | (6 options) | String array |
| 2.7.3 | `reverse_manager_approval_days` | 7 | Integer |
| 2.7.4 | `reverse_block_cascaded` | true | Boolean |

**Default reasons list:**
1. ลงบัญชีผิด
2. ผู้ขายผิด
3. ยกเลิกการซื้อ
4. คำนวณ VAT/WHT ผิด
5. จำนวนเงินผิด
6. อื่นๆ (ระบุเอง)

---

### 2.8 Custom Income/Deduction (2 items) — **P1**
> **Rationale:** PAYROLL Custom · V17, V18

| # | Setting | Default | Type |
|---|---------|---------|------|
| 2.8.1 | `custom_income_accounts_whitelist` | 53-XXXX (Expense only) | Account list |
| 2.8.2 | `tax_exempt_warning_enabled` | true | Boolean |

**Detection Hint:**
- ตรวจ PAYROLL form มี expandable row สำหรับ custom income/deduction
- ถ้าไม่มี → ❌

---

### 3.4 Smart Switch (2 items) — **P2**
> **Rationale:** SAMEDAY ↔ ACCRUAL auto-switch

| # | Setting | Default | Type |
|---|---------|---------|------|
| 3.4.1 | `smart_doctype_switch_enabled` | true | Boolean |
| 3.4.2 | `smart_switch_threshold_days` | 0 | Integer |

---

### 3.5 Expense Summary (3 items) — **P2**
> **Rationale:** DailySheet → ExpenseSummary · Chip-style date range

| # | Setting | Default | Type |
|---|---------|---------|------|
| 3.5.1 | `summary_default_range` | today | Enum |
| 3.5.2 | `summary_all_range_warning` | true | Boolean |
| 3.5.3 | `summary_pagination_size` | 50 | Integer |

---

### 3.6 Multi-bill Picker (3 items) — **P2**
> **Rationale:** SETTLEMENT Pattern C

| # | Setting | Default | Type |
|---|---------|---------|------|
| 3.6.1 | `settlement_max_bills_per_doc` | 100 | Integer |
| 3.6.2 | `settlement_default_tick_behavior` | none | Enum (none/all/overdue) |
| 3.6.3 | `settlement_partial_payment_enabled` | true | Boolean |

---

### P3 Configuration Defaults (15 items)
> ค่า default ที่ tune ได้ · ไม่ critical

(รายละเอียดในใน Core v2.0 · มี timeout, batch size, UI defaults ฯลฯ)

---

## 📊 รายการ Settings ที่ **ไม่เปลี่ยน** จาก v1.0 (52 items)

### P0 (18 เดิม)
- 1.1 Account Role Map (7)
- 1.2 Document Numbering (5)
- 1.3 Tax Rates (6) — ใช้ SSO ภายใต้ 1.3 ต้อง refine ตาม 1.4 ใหม่

### P1 (22 เดิม)
- 2.1 Approval Workflow (6)
- 2.2 Voucher Branding (7)
- 2.3 Display Preferences (6)
- 2.4 Templates Management (5)

### P2 (12 เดิม)
- 3.1 Notifications (4)
- 3.2 User Permissions RBAC (4)
- 3.3 Integration (4)

---

## ⚠ Items ที่ต้อง **Update** (ไม่ใช่เพิ่มใหม่)

### 1.3 Tax Rates → Refine SSO sub-items
| Sub-item | v1.0 | v2.0 |
|----------|------|------|
| SSO rate | 5% (fixed) | 5% + effective_from |
| SSO max contribution | 750 บ (fixed) | 875 บ (default ปี 2569) + configurable |
| SSO salary ceiling | 15,000 บ (implicit) | 17,500 บ (default) + configurable |

→ ต้อง migrate ข้อมูลเดิม + UI ใหม่

---

## 📋 Migration Path

ถ้า Dev เริ่มทำ v1.0 ไปแล้ว ต้อง migrate:

1. **เพิ่ม table:** `settings_categories` (สำหรับ group settings)
2. **เพิ่ม columns ใน `settings`:**
   - `effective_from` DATE
   - `effective_to` DATE
   - `priority` ENUM('P0','P1','P2','P3')
3. **Run migration script:**
   - Insert 50 new settings ด้วย default values
   - Update existing SSO entries with new ceiling
4. **Re-run Audit Phase 1+2** หลัง migration

---

## 📞 ติดต่อ

ถ้ามีคำถามเที่ยวกับ rationale ของ setting ใหน → ดู:
- Mockup v5: `expense_module_mockup_v5.html`
- Implementation Review: `Implementation_Review_Business_Expense_v1.0.pdf`
- Action Items: `Business_Expense_Module_Dev_Action_Items.docx`

---

**END OF CHANGE LOG**
