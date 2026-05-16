# Implementation Review v2.0 · Business Expense Module

> **Markdown extract from `Implementation_Review_v2.0.html` (originally ~33 KB).**
> Owner brief — Final · 15 พ.ค. 69. Full styled HTML in 2026-05-16 conversation history.

**Owner:** BESTCHOICE FINANCE × SHOP
**Audience:** Backend Dev · QA · DBA
**Supersedes:** v1.0 (12 พ.ค. 69)

---

## Executive Summary

Implementation Review v2.0 — สรุปผลการปรับปรุง Business Expense Module หลังการรับฟีดแบ็คเพิ่มเติมจาก Owner ตั้งแต่ Deploy v1.0 (11 พ.ค. 69) จนถึงปัจจุบัน (15 พ.ค. 69).

**v2.0 NEW:**
- ขยาย scope จาก 5 actions เป็น 18+ items
- เพิ่ม flow ใหม่ 5 หน้า (Settlement, Payroll, Credit Note, Reverse, Petty Cash)
- เปลี่ยนแปลงตามกฎหมายใหม่ (SSO เพดาน 875 บ ปี 2569)
- V-Rules ใหม่ 5 ตัว (V16-V20)
- Settings เพิ่ม 50 items (รวม 102)

### Stats
- 13 หน้า UI ทั้งหมด (เพิ่ม 5 หน้าใหม่ จากเดิม 8 หน้า)
- 20 Validation Rules (เพิ่ม V16-V20 จากเดิม V1-V15)
- 102 Settings Items (เพิ่ม 50 จากเดิม 52)
- SSO เพดานใหม่ 875 บ (เพิ่มจาก 750 ตามกฎกระทรวง 2569)

### 🚨 Critical สำหรับ Owner
เพดาน SSO เปลี่ยนเป็น 875 บ ตั้งแต่ 1 ม.ค. 69 ตามกฎกระทรวง → ถ้าระบบยังคำนวณด้วย 750 บ จะ**ผิดกฎหมาย**และต้องคำนวณย้อนหลังให้พนักงานทุกคน Dev ต้องแก้ในๆ Sprint แรก

---

## Timeline

| วันที่ | กิจกรรม | ผลลัพธ์ |
|---|---|---|
| 11 พ.ค. 69 | Deploy v1.0 | 52 settings · 8 หน้า UI · Compliance C+ (65/100) |
| 12 พ.ค. 69 | Audit Report (PDF) | พบ bug 5 ข้อ + UX issues |
| 13-14 พ.ค. 69 | Spec v2.2 + Action Items + Settings v1.0 | Compliance ขึ้นเป็น A (88/100) |
| 15 พ.ค. 69 | Owner คุยกับ AI 13 รอบ | เพิ่ม flow ใหม่ 5 หน้า · 50 settings · 5 V-rules |
| **15 พ.ค. 69** | **Spec v5 / Review v2.0** | **13 หน้า UI · 102 settings · 20 V-rules · ครอบคลุมกฎหมาย 2569** |

---

## What's New (v2.0)

1. **5 หน้า UI ใหม่**: SettlementPage · PayrollPage · CreditNotePage · Reverse Dialog · Petty Cash
2. **1 หน้าเปลี่ยนชื่อ**: DailySheet → ExpenseSummary (chip-style date range)
3. **V-Rules ใหม่ 5 ตัว**: V16 (Taxable Income) · V17 (Custom Income Account) · V18 (Custom Deduction) · V19 (วันที่จ่าย ≤ วันปิดงวด) · V20 (Petty Cash)
4. **50 Settings ใหม่**: SSO Configurable · Petty Cash · Adjustment Routing · Voucher Print Modes · Period Lock · Reverse Entry · Custom Income · Smart Switch · Expense Summary · Multi-bill Picker
5. **กฎหมายใหม่ปี 2569**: SSO เพดาน 875 บ (จากเดิม 750) ตามกฎกระทรวง

---

## Bug Fixes · 5 Actions (จาก v1.0)

| # | Priority | Action | เวลา |
|---|---|---|---|
| 1 | P0 Critical | แก้ `adj_underpay` role mapping → 52-1104 (ไม่ใช่ 53-1503) | 30 นาที |
| 2 | P1 High | ขยาย Multi-line Adjustment → SETTLEMENT | 1-2 วัน |
| 3 | P1 High | ตรวจสอบ Reclassify Migration ตกหล่น | 0.5 วัน |
| 4 | P2 Medium | ยืนยัน Test Suite J + K ครบ (เพิ่ม J-04 · K-07 · K-08) | 1 วัน |
| 5 | P1 High | ตามค่าเสื่อม มี.ค.-เม.ย. 2569 ที่หาย | 0.5 วัน |

📋 รายละเอียดเต็มดูใน `Dev_Action_Items_v1.0.md` — มี SQL queries · code patches · test cases · sign-off checklist

---

## Flow ใหม่ 5 หน้า

### 1. SettlementPage — Multi-bill Picker (Pattern C)
- **1 ใบ = 1 supplier ในใบเดียวกัน** (มาตรฐานบัญชีไทย)
- Inline table แสดงบิลค้างชำระทั้งหมดของ supplier นั้น
- Default = ไม่ tick · User เลือกทุกบิลเอง
- ช่อง "จะจ่าย" แก้ได้ต่อบิล → **รองรับ Partial Payment**
- Section 5 รองรับ Adjustment (Action #2)

### 2. PayrollPage — Custom Income/Deduction
- การาหรือพนักงาน expandable → คลิก row ให้แสดง Custom Income + Deduction ต่อคน
- 3 วิธีกรอกข้อมูล: Load จาก Employee Master · Import Excel · Load จากงวดก่อน
- WHT auto-calc จาก taxable income (การาห ภ.ง.ด.91)
- Slip auto-generate PDF + ส่ง email ทันที

### 3. CreditNotePage — 2 Modes
- **Mode A — อ้างอิงใบเครดิม** (default): เลือกใบ EXP ต้นทาง → ระบบ load บัญชี+ยอด+VAT มาให้ใช้
- **Mode B — Standalone**: ผู้ใช้ระบุ supplier + บัญชี + ยอดเอง

### 4. Reverse Dialog — Modal Confirmation
- Dropdown 6 reasons + Free text (จำเป็น)
- JE Preview ทั้งคู่: เก่าเดิม + JE Reverse ใหม่
- Date picker วันที่ Reverse (ต้อง ≤ วันปิดงวด)
- Cascade check: ถ้ามี child SETTLEMENT/CN → block
- Audit log: user + timestamp + reason_code + reason_detail

### 5. Petty Cash Reimbursement — Doc Type ใหม่
- Setup ครั้งเดียว: สร้างบัญชี 11-1103 เงินสดย่อย · กำหนดวงเงิน 5,000 บ · เ-ขาดคนการาห
- ใช้เงินระหว่างวัน: ไม่ลง JE บัญชี → ใช้เป็นใบเสร็จ
- เบิกคขชดเชย (สิ้นวัน/สัปดาห์): สร้าง EXP type `PETTY_CASH_REIMBURSEMENT` · หลาย row · ในแต่ละ row มี supplier แยก

---

## PAYROLL JE Example (V16/V17/V18 implementation)

ตัวอย่าง JE (นาย ก. · เงินเดือน 25,000 · ค่าเดินทาง 800 · กาส 500):

```
// Taxable Income = 25,000 + 800 − 500 = 25,300
// WHT (ภงด.1)    = 312
// SSO ลูกจ้าง    = 875  ← เพดานใหม่ปี 2569
// สุทธิที่จ่าย   = 25,300 − 312 − 875 = 24,113

Dr 53-1101 เงินเดือน           24,500.00    // 25,000 − 500
Dr 53-1108 ค่าเดินทาง            800.00    // custom income
Dr 53-1102 ค่าใช้จ่าย SSO นายจ้าง   875.00    // เพดาน 2569
  Cr 11-1201 ธ.KBank            24,113.00    // สุทธิ
  Cr 21-3102 ภงด.1 ค้างนำส่ง      312.00
  Cr 21-3105 SSO ลูกจ้างค้างนำส่ง   875.00
  Cr 21-3106 SSO นายจ้างค้างนำส่ง   875.00

                          Dr = 26,175.00  Cr = 26,175.00  ✓ BALANCED
```

⚠ **V16 Warning** — ค่าเดินทาง ม.42: ตามกฎหมายไทย ค่าเดินทางทางธุระกาส ถาน **ยกเว้นภาษี** ตามมาตรา 42(1) (เงินได้ทรงราว ตามหน้าที่ ในยศุริง) · ระบบไม่ตรวจให้ → User ต้องระบุเองว่าเป็นรายการ taxable หรือ exempt

---

## SSO เพดานใหม่ ปี 2569 · 🚨 P0 Critical

ตามกฎกระทรวงประกันสังคม มีคล่ารังใช้ **1 ม.ค. 2569** → ผกระทบค่าจ้างค่าจ้างและเงินสมทบสูงสุดเข้นย่งคุณกันใน 3 ระยะ

### การาาเงินสมทบ SSO ตามกฎหมายใหม่

| ช่วงปี | เพดานเงินเดือน | SSO สูงสุด/เดือน (5%) | เปลี่ยนจาก |
|---|---|---|---|
| ก่อน 2569 | 15,000 บ | 750 บ | ค่าเดิม |
| **2569 – 2571** | **17,500 บ** | **875 บ** | +125 บ |
| 2572 – 2574 | 20,000 บ | 1,000 บ | +125 บ |
| 2575+ | 23,000 บ | 1,150 บ | +150 บ |

### Settings ที่ต้องเพิ่ม
- `sso_salary_ceiling` · 17,500 บ (default ปี 2569) · Configurable
- `sso_max_contribution` · 875 บ · Configurable
- `sso_effective_from` / `sso_effective_to` · 01/01/69 – 31/12/71
- `sso_stepped_ceiling_support` · true (รองรับการเปลี่ยนทุก 3 ปี)

⚠ **Action สำหรับ Dev:**
1. ค้นหา `grep -r "750" apps/api/src/modules/payroll/` และ `grep -r "15000" apps/api/src/` → ถ้าเจอ hard-coded ต้องใส่ตั้งหมด
2. Migration: insert SSO config สำหรับปี 2569 · 2572 · 2575
3. Update Test Suite J-04 ให้คาด SSO = 875 บ

---

## Petty Cash Reimbursement · Doc Type ใหม่

สำหรับ flow ที่จ่ายสดหลายบิล หลาย supplier ในวันเดียว (เช่น พนักงานเบิกค่าใช้จ่ายเดินทาง — แท็กซี่ + กาเฟ + ค่ามัน + ค่าทางด่วน) ตามมาตรฐานบัญชีที่นิยม

### Flow 3 ขั้นตอน
1. **Setup (ครั้งเดียว)**: สร้างบัญชี 11-1103 เงินสดย่อย · กำหนดวงเงิน 5,000 บ · เ-ขาดคนการาห
2. **ใช้เงินระหว่างวัน**: ไม่ลง JE บัญชี → ใช้เป็นใบเสร็จ
3. **เบิกคขชดเชย** (สิ้นวัน/สัปดาห์): สร้าง EXP type `PETTY_CASH_REIMBURSEMENT` · หลาย row · ในแต่ละ row มี supplier แยก

### ตัวอย่าง JE (4 บิล รวม 1,230 บ)
```
// รายการ:
// 1. Grab Thailand     200.00 (ไม่มี VAT)        → 53-1108 ค่าเดินทาง
// 2. Cafe Y            150.00 (ไม่มี VAT)        → 53-1109 ค่ารับรอง
// 3. ปั๊ม ABC          800.00 (VAT 7%)           → 53-1110 ค่าน้ำมัน + 11-4101 VAT
// 4. การาขางด่วน        80.00 (ไม่มี VAT)        → 53-1108 ค่าเดินทาง

Dr 53-1108 ค่าเดินทาง      280.00    // 200 + 80
Dr 53-1109 ค่ารับรอง       150.00
Dr 53-1110 ค่าน้ำมัน       747.66    // 800 − 52.34
Dr 11-4101 ภาษีซื้อ         52.34    // VAT จากปั๊ม
  Cr 11-1201 ธ.KBank     1,230.00    // เบิม petty cash กลับ

                       Dr = 1,230.00  Cr = 1,230.00  ✓
```

📌 **จุดสำคัญ**: Cr = `11-1201` (ธนาคาร) · **ไม่ใช่** `11-1103` (petty cash) เพราะเป็นการ **เบิมเงินกลับ** ให้ petty cash · ไม่ใช่จ่ายจาก petty cash โดยตรง

---

## V-Rules · ใหม่ 5 ตัว (V16-V20)

| Rule | หน้าที่ที่ | คำอธิบาย |
|---|---|---|
| **V16** NEW | PAYROLL Taxable Income | `taxable = base + Σ(income) − Σ(deduction)` · WHT คิดจาก taxable (ม.40) · ค่าเดินทาง ม.42 User ระบุเอง |
| **V17** NEW | Custom Income Account | `account_code` ต้องอยู่ในหมวง 53-XXXX (Expense) + active ใน CoA |
| **V18** NEW | Custom Deduction | `Σ(deduction)` ต้อง ≤ `base + Σ(income)` · ห้าม taxable < 0 |
| **V19** NEW | วันที่จ่าย ≤ วันปิดงวด | `payment_date` ≤ `period_close_date` · warning ถ้าย้อนหลัง > 30 วัน |
| **V20** NEW | Petty Cash Reimbursement | Σ(items) ≤ วงเงิน · ทุก row ต้องมี supplier · VAT/WHT per row · บัญชี Cr = 11-1201 (ไม่ใช่ 11-1103) |

### V-Rules เดิม (V1-V15)

ทุกตัวยังใช้งานปกติ · มี 1 ตัวที่ **update scope**:
- **V12** · Adjustment Sum = diff (UPDATED) → ครอบคลุม SAMEDAY + SETTLEMENT (Action #2)

---

## Settings · เพิ่ม 50 items (รวม 102)

ดูรายละเอียดในใน `Settings_Audit_Core_v2.0.md` · ที่ที่สรุปภาพรวม:

| Priority | เดิม v1.0 | ใหม่ v2.0 | เพิ่ม | คำอธิบาย |
|---|---|---|---|---|
| P0 Critical | 18 | **30** | +12 | SSO Configurable · Petty Cash · Adjustment Routing |
| P1 High | 22 | **37** | +15 | Voucher Print · Period Lock · Reverse Entry · Custom Income |
| P2 Medium | 12 | **20** | +8 | Smart Switch · Expense Summary · Multi-bill Picker |
| P3 Config | 0 | **15** | +15 | UI defaults · Performance · Compliance |
| รวม | 52 | 102 | +50 | |

### 4-Phase Workflow (สำหรับ AI Dev)
1. **Phase 1 · AUDIT** → ตรวจ codebase ตาม Detection Hint, mark ✅/❌/◐
2. **Phase 2 · REPORT** → สรุปผลใน markdown table
3. **Phase 3 · WAIT** → รอ Owner approve scope (⚠ ห้าม implement ทันที)
4. **Phase 4 · IMPLEMENT** → เฉพาะ items ที่ approve + tests + migration

---

## เลื่อนการ implement · ขั้นต่ไป

### ⏸ Internal Control Minimal — DEFERRED
Owner เลือกขจัามทำตอน · จะทำใน Sprint ถัดไป

Scope: Approval Workflow + Period Lock + RBAC ที่ที่ใช่งาน (4 roles: Owner/Manager/Accountant/Viewer)
V-rules ที่จะเพิ่ม: V21 (Approval Required) · V22 (Period Lock) · V23 (Permission Check)
Settings ที่จะเพิ่ม: ~15 items

---

## Deliverables · 7 ไฟล์

| # | ไฟล์ | สำหรับ | เนื้อหา |
|---|---|---|---|
| 1 | `README_FOR_DEV.md` | ทุกคน · เริ่มที่นี่ | Cover note + ลำดับการอ่าน |
| 2 | `Implementation_Review_v2.0.md` (NEW) | Owner + Dev | เอกสารฉบับนี้ — ภาพรวมทั้งหมด |
| 3 | `expense_module_mockup_v5.md` | Dev · UI reference | 13 หน้า UI · interactive |
| 4 | `Settings_Audit_Index.md` | Dev · entry | Quick overview Settings |
| 5 | `Settings_Audit_Core_v2.0.md` | Dev · task brief | 102 items + Detection Hint |
| 6 | `Settings_Audit_Change_Log.md` | Owner + Dev | v1.0 → v2.0 diff |
| 7 | `Dev_Action_Items_v1.0.md` | Dev · bug fixes | 5 actions + SQL + code patches |

### ไฟล์ที่ **ถูกแทนที่** (ไม่ต้องอ่านอีก)
- `Developer_Spec_v2_2.docx` → **ถูกแทนที่ด้วย** mockup v5 (รวม v2.2 + 5 หน้าใหม่)
- `Settings_Audit_AI_Dev.docx` v1.0 → **ถูกแทนที่ด้วย** Settings Audit Core v2.0 (52 → 102 items)
- `expense_module_mockup_v2.html` → **ถูกแทนที่ด้วย** mockup v5
- `Implementation_Review_v1.0.pdf` → **ถูกแทนที่ด้วย** เอกสารที่ที่ที่ (v2.0)

---

**BESTCHOICE FINANCE × SHOP** · Business Expense Module · Implementation Review v2.0
15 พฤษภาคม 2569 · เอกสารที่ที่ที่ที่ v1.0 ที่ที่ที่ที่
