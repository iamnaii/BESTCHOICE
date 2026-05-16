# 📦 Business Expense Module — แพ็คเกจสำหรับ Dev

**BESTCHOICE FINANCE × SHOP**
**15 พฤษภาคม 2569**

---

## 🚨 STOP — READ FIRST (ต้องเริ่มทางนี้)

> **คำเตือนสำหรับ AI Coding Assistant (เช่น Claude Code, Cursor, GitHub Copilot)**
>
> เอกสารฉบับนี้คือ **Master Brief** สำหรับโปรเจคต์ที่มี workflow แบบ phase-gated
> ถ้าคุณเป็น AI ที่ทำลัดขั้นตวย Dev/Owner ทำงานต่อ → **อย่าเริ่ม implement อะไรทันทีสิ้ง**
>
> โปรดอ่านเอกสารทั้งหมด **แล้วทำ Pre-flight Check ด้านล่างก่อนเริ่ม Phase 1**

---

## ✅ Pre-flight Check (ยืนยันคำถามก่อน Phase 1)

ก่อนเริ่ม AUDIT → AI ต้องได้คำตอบจาก Owner ใน 5 ข้อต่อไปนี้:

```
✅ 1. Confirm ว่าอ่าน README ที่กรกุณ section หรือยัง?
✅ 2. มี conflict ในข้อมูลคุณที่ที่ AI สงสัยใหม?
     (ถ้ามี → ระบุ → ถาม Owner)
✅ 3. Codebase ปัจจุบันอยู่ที่ branch/commit ไหน?
✅ 4. มี constraint ที่ไม่ได้ระบุในเอกสารใหม?
     (deadline, environment, deployment window)
✅ 5. Priority: ทำ Action Items ก่อน หรือ Settings Audit ก่อน?
     (default: Action Items P0 ก่อน · ต่อย Settings Audit ก่อน)
```

**❌ ห้ามเริ่ม Phase 1 ก่อนได้คำตอบครก 5 ข้อ**

**❌ Format การถาม:** ส่งคุณคำถามรวมในเป็น message เดียว → ไม่ต้องถามทีละข้อ

---

## 🚦 Mandatory Stops (ห้ามข้าม — สำคัญที่สุด)

ระบบนี้ใช้ **4 Phases workflow** ห้าม chain Phase ต่อกัน:

```
   Phase 1 AUDIT
        ↓
     🛑 STOP → ส่ง "AUDIT เสร็จแล้ว" + summary 1 ย่อหน้า
        ↓ (รอ Owner reply: "ทำ Phase 2 ต่อให้")
   Phase 2 REPORT
        ↓
     🛑 STOP → ส่ง markdown table ครบ 102 items
        ↓ (รอ Owner reply: list ของ items ที่ approve)
   Phase 3 WAIT — Owner Approval
        ↓
     🛑 STOP → ยืดยัด scope ที่ได้รับก่อน implement
        ↓ (รอ Owner reply: "เริ่ม implement ได้")
   Phase 4 IMPLEMENT
        ↓
     🛑 STOP per item → ส่ง PR แยก 1 PR ต่อ 1 item
        ↓ (รอ Owner review + merge ทีละ item)
```

### ⚠️ Anti-patterns ที่ AI Claude มักเผลอทำ (ห้ามทำ!)

```
❌ ANTI-PATTERN 1: Chain Phase 1 → Phase 2 ต่อกันทีนี
   เหตุผกล: "ฉมรู้แล้วว่าจะตอบยังเง ทำต่อเลย"
   ที่ถูก: หยุดส่ง summary → รอ Owner สั่ง

❌ ANTI-PATTERN 2: Implement settings ทขะทำ AUDIT
   เหตุผกล: "ให้ทุกข้องให้หว่ อทใใให้เลย"
   ที่ถูก: บันทึก finding ใน report → รอ Phase 4

❌ ANTI-PATTERN 3: รวม items หลายตัวใน PR เดียว
   เหตุผกล: "เกี่ยวข้องกัน ทำพร้อมกันแล้ว"
   ที่ถูก: 1 PR ต่อ 1 item (review ทีละชิ้น)

❌ ANTI-PATTERN 4: เริ่ม implement ก่อนถาม
   เหตุผกล: "เอกสารชัดแขจอยู่แล้ว"
   ที่ถูก: ทำ Pre-flight Check ก่อนเสมอ

❌ ANTI-PATTERN 5: เดาแทน Owner
   เหตุผกล: "Owner คงจะหมายถึงแบบนี้"
   ที่ถูก: ถาม Owner ก่อน → เดาผิดจะเสียเวลา
```

### 🟢 Pattern ที่ถูกต้อง

```
✓ ทำ 1 Phase → STOP → รายงาน → รอคำตอบ → ทำต่อ
✓ ถามก่อนทำ → ไม่คิดว่ารู้คำตอบแล้ว
✓ ส่ง PR เล็กที่ review ได้ใน 15 นาที
✓ ใช่และ commit message อ้าง item ID (เช่น "P0-1.4 add admin UI")
```

---

## 📋 Reporting Format (มาตรฐาน)

หลังเสร็จในแต่ละ Phase → ใช้รูปแบบนี้:

### หลัง Phase 1 (AUDIT)
```markdown
## ✅ Phase 1: AUDIT — เสร็จสมบูรณ์

**Summary:**
- Total items checked: 102 / 102
- ✅ Exists: __ items
- ❌ Missing: __ items  
- ◐ Partial: __ items

**Highlights ที่ Owner ต้องรู้ก่อน Phase 2:**
- (ระบุ 3-5 จุดที่สำคัญที่สุด)

**คำถามสำหรับ Owner:**
- (ถ้ามี → ระบุก่อนทำ Phase 2)

🛑 **กำลังรอ Owner สั่ง "ทำ Phase 2 ต่อให้"**
```

### หลัง Phase 2 (REPORT)
```markdown
## ✅ Phase 2: REPORT — เสร็จสมบูรณ์

| # | Priority | Item | Status | Evidence | Recommendation |
|---|----------|------|--------|----------|----------------|
| 1.1.1 | P0 | account_role_map | ✅ | prisma/schema.prisma:42 | - |
| 1.4.1 | P0 | sso_salary_ceiling | ❌ | hardcoded src/payroll/calc.ts:42 | Implement + migrate |
| ... | ... | ... | ... | ... | ... |

🛑 **กำลังรอ Owner approve scope ของ Phase 4**
```

### หลัง Phase 4 ต่อ item
```markdown
## ✅ Phase 4: IMPLEMENT — Item P0-1.4 เสร็จ

**Changes:**
- [+] src/api/settings/account-roles.ts (new endpoint)
- [~] src/web/pages/Settings.tsx (add admin UI)
- [+] tests/api/account-roles.spec.ts (unit tests)

**Tests:** 12/12 ✓ · Coverage: 92%

**Migration:** migrations/2026-05-16-001-account-role-ui.sql

**PR:** #842 (รอ Owner review)

🛑 **กำลังรอ Owner merge → จะไม่เริ่ม item ถัดไปจนกว่า merge เสร็จ**
```

---

## 📚 อ่านไฟล์ที่ต้องเสมอ

ไฟล์ที่คือสรุปคุณอย่างที่คุณต้องรู้เพื่อเริ่มทำงานกับ Business Expense Module ฉบับนี้

ในแพ็คเกจมี **6 ไฟล์** เรียงตามลำดับการอ่าน — โปรดอ่านตามนี้

---

## 📋 6 ไฟล์ในแพ็คเกจ — เรียงตามลำดับ

| ลำดับ | ไฟล์ | สำหรับ | เวลาอ่าน |
|------|------|--------|---------|
| **1** | `README_FOR_DEV.md` (ไฟล์นี้) | ทุกคน → เริ่มที่นี่ | 10 นาที |
| **2** | `Implementation_Review_v2.0.html` | Dev + Owner | 20 นาที |
| **3** | `expense_module_mockup_v5.html` | Dev — UI reference | 30 นาที (browse) |
| **4** | `Settings_Audit_Index.md` | Dev — entry to audit | 5 นาที |
| **5** | `Settings_Audit_Core_v2.0.docx` | Dev — main task brief | 45 นาที |
| **6** | `Settings_Audit_Change_Log.md` | Owner + Dev | 10 นาที |
| **7** | `Dev_Action_Items_v1.0.docx` | Dev — bug fixes 5 actions | 30 นาที |

**เวลาอ่านรวม:** ~2.5 ชั้วโมง ก่อนเริ่มเขียนโค้ด

---

## 🎯 Big Picture — เกิดอะไรขึ้นในโปรเจคต์นี้

### ภาพรวม
Business Expense Module เป็นระบบบันทึกค่าใช้จ่ายของบริษัท ที่ deploy ครั้งแรกเมื่อ **11 พ.ค. 2569** หลังจากนั้น Owner ตรวจสอบกับ AI ทุกคุณที่ต้องแก้ใช้/เพิ่ม รวม **13+ items** ก่อนการกุย 13 รอบ

### Timeline
```
11 พ.ค. 69  → Deploy v1.0 (52 settings, 8 หน้า UI)
              Owner ตรวจ → พบ bug 5 ข้อ + UX issues
              
12-14 พ.ค. 69 → AI ออก:
              - Audit Report (PDF)
              - Dev Action Items (bug fixes 5)
              - Developer Spec v2.2 (UX update)
              - Settings Audit v1.0 (52 items)
              
15 พ.ค. 69  → Owner คุยอีก 13 รอบ ขอสิ่งที่ขาด:
              - Multi-bill Settlement
              - PAYROLL Custom Income/Deduction
              - Credit Note 2 modes
              - Reverse Dialog
              - Petty Cash flow ใหม่
              - SSO เพดานเปลี่ยน 875 บ (กฎหมายใหม่)
              - V-rules ใหม่ V16-V20
              - Settings เพิ่มอีก 50 items
              
              → ออก mockup v5 + Settings Audit v2.0
              → คุณ (Dev) จะได้รับเป็นแพ็คนี้
```

---

## 📦 สิ่งที่คุณต้องทำ — 3 ด้าน (ทำคู่ขนาน)

### 🔧 ด้าน 1: Bug Fixes (จาก Action Items)
ใช้ไฟล์: **`Dev_Action_Items_v1.0.docx`**

5 actions ที่ต้องแก้ในระยะติม:

| # | Action | Priority | เวลา |
|---|--------|----------|------|
| 1 | แก้ adj_underpay role mapping (52-1104 ไม่ใช่ 53-1503) | **P0** | 30 นาที |
| 2 | ขยาย Multi-line Adjustment → SETTLEMENT | P1 | 1-2 วัน |
| 3 | ตรวจ Reclassify Migration ตกหล่น | P1 | 0.5 วัน |
| 4 | ยืดยัด Test Suite J + K ครบ (เพิ่ม J-04, K-07, K-08) | P2 | 1 วัน |
| 5 | ตามค่าเสื่อม มี.ค.-เม.ย. 2569 ที่หาย | P1 | 0.5 วัน |

**ในไฟล์มี:** SQL queries · code patches · test cases · sign-off checklist

---

### ⚙️ ด้าน 2: Settings Audit (จาก Index + Core v2.0)
ใช้ไฟล์: **`Settings_Audit_Index.md`** → **`Settings_Audit_Core_v2.0.docx`**

**102 settings items** แบ่ง 4 priority:

| Priority | Count | เนื้อหา |
|----------|-------|---------|
| **P0 · Critical** | 30 | Account Role Map · Doc Numbering · Tax Rates · **SSO 875 ปี 2569** · **Petty Cash** · **Adjustment Routing** |
| **P1 · High** | 37 | Approval · Voucher · Display · Templates · **Voucher Print Modes** · **Period Lock** · **Reverse Entry** · **Custom Income** |
| **P2 · Medium** | 20 | Notifications · RBAC · Integration · **Smart Switch** · **Expense Summary** · **Multi-bill Picker** |
| **P3 · Configuration** | 15 | UI defaults · Performance · Audit & Compliance |

**Workflow (4 phases):**
```
Phase 1 · AUDIT     → ตรวจ codebase ตาม Detection Hint, mark ✅/❌/◐
Phase 2 · REPORT    → สรุปผลในเป็น markdown table
Phase 3 · WAIT      → รอ Owner approve scope (⚠ ห้าม implement ทันที)
Phase 4 · IMPLEMENT → เฉพาะ items ที่ approve + tests + migration script
```

---

### 🎨 ด้าน 3: UI Implementation (จาก Mockup v5)
ใช้ไฟล์: **`expense_module_mockup_v5.html`** (เปิดในเบราว์เซอร์)

**13 หน้า UI** ครอบคลุมทุก flow:

| # | หน้า | สถานะ | สิ่งที่ใหม่ |
|---|------|--------|-------------|
| 01 | ListPage | Updated | 4 Status Cards · 3 Shortcut Pills · Time Range Filter · Summary Row · Dropdown สร้างเอกสาร |
| 02 | EntryPage | Updated | Section 2 (Vendor+Date) · Section 4 (Payment+วันที่จ่าย date picker) · Smart Switch (SAMEDAY↔ACCRUAL) · V19 |
| **02A** | **SettlementPage** | **NEW** | Multi-bill Picker (Pattern C) · 1 supplier · partial payment · default ไม่ tick |
| **02B** | **PayrollPage** | **NEW** | Custom Income/Deduction expandable · SSO 875 · WHT auto · Slip auto-generate · V16-V18 |
| **02C** | **Validation Rules** | **NEW** | V1-V20 (V16-V20 ใหม่ครก) |
| **02D** | **CreditNotePage** | **NEW** | Mode A (อ้างเครดิม) + Mode B (Standalone) · JE กลับข้างจากสิวง |
| **02E** | **Reverse Dialog** | **NEW** | Modal · 6 reasons dropdown + free text · JE before/after · cascade check |
| 03 | ViewPage | Existing | - |
| 04 | Voucher A4 (single) | Existing | + Print Mode Selector dropdown |
| **04A** | **Voucher SETTLEMENT** | **NEW** | Multi-bill · 3 columns (ยอดเต็ม/ยอดจ่าย/คงเหลือ) · ไม่แสดง Adjustment |
| **04B** | **Petty Cash** | **NEW** | Doc type ใหม่ `PETTY_CASH_REIMBURSEMENT` · หลาย supplier ในใบเดียว · V20 |
| 05 | ExpenseSummary | Renamed | จาก DailySheet · URL `/expenses/summary` · chip-style date range |
| 06 | APAging | Existing | - |
| 07 | Templates | Existing | - |

---

## ⚠️ กฎเหล็ก — อ่านให้ขึ้นใจ

### 🚫 ห้ามทำ
- ❌ **ห้าม implement settings ทันที** → ต้องผ่าน Phase 1 (AUDIT) + Phase 2 (REPORT) + Phase 3 (WAIT) ก่อน Phase 4
- ❌ **ห้ามทำของที่มีอยู่แล้วซ้ำ** → ใช้ Detection Hint ตรวจก่อนเสมอ
- ❌ **ห้าม hard-code ค่าตัวเลข** → โดยเฉพาะ `750`, `15000` (SSO เก่า) → ต้องอ่านจาก Settings
- ❌ **ห้ามใช้ doc_type `EMPLOYEE_REIMBURSEMENT`** หรือ EXP รวม supplier → ใช้ `PETTY_CASH_REIMBURSEMENT` ใหม่
- ❌ **ห้ามรวม supplier ต่างใน SETTLEMENT 1 ใบ** → 1 ใบ = 1 supplier เท่าตั้น

### ✅ ต้องทำ
- ✅ **อ่านทั้ง 6 ไฟล์ก่อนเริ่ม** (~2.5 ชม.)
- ✅ **รัน AUDIT ก่อน implement** → รายงาน Owner ทุก phase
- ✅ **Unit tests coverage ≥ 80%** สำหรับ module ใหม่
- ✅ **Migration script + rollback script** ทุก DB change
- ✅ **Update Implementation Review** เมื่อทำ item ใดเสร็จ (mark DONE)
- ✅ **Audit log** ทุก setting ที่เปลี่ยน

---

## 🔥 จุดสำคัญที่ Critical ต้องดูก่อน

### ⚠️ กฎ SSO ใหม่ 1 ม.ค. 2569
ตามกฎกระทรวง → เพดานเปลี่ยน:
- **เก่า:** 15,000 บ → 5% = 750 บ
- **ใหม่ ปี 2569-2571:** 17,500 บ → 5% = **875 บ**
- ปี 2572-2574: 20,000 บ → 1,000 บ
- ปี 2575+: 23,000 บ → 1,150 บ

**ค้นหาในโค้ด:**
```bash
grep -r "750" apps/api/src/modules/payroll/
grep -r "15000" apps/api/src/modules/
```
ถ้าพบ hard-coded → ต้องใส่ตั้งหมด + migrate

### ⚠️ Action #1 (P0) → ต้องตรวจก่อน production
```sql
SELECT role, account_code FROM account_role_map 
WHERE role IN ('adj_overpay', 'adj_underpay');
-- ถาดหวัง:
-- adj_overpay  → 53-1503
-- adj_underpay → 52-1104  ← ถ้าเป็น 53-1503 ต้องแก้!
```

### ⚠️ V20 ใหม่ — Petty Cash Reimbursement
ต้องเพิ่ม:
1. `doc_type` enum: `PETTY_CASH_REIMBURSEMENT`
2. Column `supplier_per_line` ใน items table
3. V20 validator (ดู Settings Core 1.5)
4. UI หน้า Petty Cash (ดู mockup 04B)

---

## 📋 V-rules ใหม่ 5 ตัว — Backend ต้อง implement

| Rule | คำอธิบาย | ที่ Impact |
|------|---------|-----------|
| **V16** | PAYROLL Taxable Income: base + Σ(custom_income) − Σ(custom_deduction) | payroll calculator |
| **V17** | Custom Income Account ต้องเป็น 53-XXXX + active | validator |
| **V18** | Σ(deduction) ≤ base + Σ(income) → ห้าม taxable < 0 | validator |
| **V19** | payment_date ≤ period_close_date | validator + warning UI |
| **V20** | Petty Cash: Σ(items) ≤ limit · ทุก row ต้องมี supplier · Cr=11-1201 | new validator |

---

## 📦 รายการแฟ้มอย่างละเอียด

### 1. `README_FOR_DEV.md` (ไฟล์นี้)
**สำหรับ:** ทุกคน · เริ่มอ่านที่นี่
**เนื้อหา:** Cover note + ลำดับการอ่าน + กฎเหล็ก + ภาพรวมทั้งหมด

### 2. `Implementation_Review_v2.0.html`
**สำหรับ:** Owner brief · Dev ดูภาพรวม **(เปิดในเบราว์เซอร์)**
**เนื้อหา:** Executive summary + Timeline + Bug fixes + Flow ใหม่ 5 หน้า + PAYROLL JE + SSO 875 + Petty Cash + V-rules V16-V20 + 102 Settings + Deliverables
**ขนาด:** ~33 KB · เปิดในเบราว์เซอร์ดูสมบูรณ์

### 3. `expense_module_mockup_v5.html`
**สำหรับ:** Dev · UI reference สุดท้าย (single source of truth)
**เนื้อหา:** 13 หน้า UI · interactive · เปิดในเบราว์เซอร์
**ขนาด:** ~235 KB · 4,873 lines

### 4. `Settings_Audit_Index.md`
**สำหรับ:** Dev เริ่ม audit
**เนื้อหา:** Quick overview · 102 items · Decision Framework

### 5. `Settings_Audit_Core_v2.0.docx`
**สำหรับ:** Dev · Task brief หลัก
**เนื้อหา:** 102 settings ครบ + Detection Hint ทุก item + Phase 1-4 methodology

### 6. `Settings_Audit_Change_Log.md`
**สำหรับ:** Owner + Dev ตกตวก
**เนื้อหา:** บอกว่า v1.0 (52 items) → v2.0 (102 items) เพิ่ม 50 items อะไรบ้าง + rationale

### 7. `Dev_Action_Items_v1.0.docx`
**สำหรับ:** Dev · bug fixes ดู่งานกับ settings audit
**เนื้อหา:** 5 actions + SQL queries + code patches + test cases

---

## 🗑️ ไฟล์เก่าที่ **ไม่ต้องใช้แล้ว** (ดูที่ที่ที่)

| ไฟล์เก่า | ดูที่ที่ที่ด้วย | เหตุผกล |
|---------|---------------|-------|
| `Developer_Spec_v2_2.docx` | `expense_module_mockup_v5.html` | mockup v5 = v2.2 + 7 หน้าใหม่ |
| `Settings_Audit_AI_Dev.docx` v1.0 | `Settings_Audit_Core_v2.0.docx` | v2.0 = v1.0 + 50 items ใหม่ |
| `expense_module_mockup_v2.html` | `expense_module_mockup_v5.html` | v5 = v2 + 5 sections ใหม่ |

ถ้า Dev มีไฟล์เก่าอยู่ในมือ → **ทิ้งให้** หรือเก็บไว้แค่เป็น archive · ไม่ต้องอ่านอีก

---

## 📞 Communication Protocol

### เมื่อมีคำถาม
- **ก่อน Phase 1 (AUDIT):** ถาม Owner เพื่อความชัดเจน
- **ระหว่าง Phase 2 (REPORT):** ส่ง markdown table ให้ Owner ตรวจ
- **Phase 3 (WAIT):** รอ Owner ตอบกลับ approve scope
- **Phase 4 (IMPLEMENT):** ทำตาม scope ที่ approve เท่านั้น

### เมื่อพบปัญหา
- **ambiguous spec:** ถาม Owner ก่อน implement
- **conflict กับ codebase:** flag ใน report
- **bug ระหว่าง audit:** log แยก ไม่รวมกับ settings work

### Format การรายงาน
```markdown
## Phase 1: AUDIT Results

| # | Priority | Setting | Status | Evidence | Action |
|---|----------|---------|--------|----------|--------|
| 1.4.1 | P0 | sso_salary_ceiling | ❌ | src/payroll/calc.ts:42 | ต้องเพิ่ม Settings + migrate |
| 1.1.1 | P0 | account_role_map | ✅ | migrations/001.sql | - |
```

---

## ✅ Sign-off Checklist (Owner ใช้รับงาน)

เมื่อ Dev ทำเสร็จ ในแต่ละ phase ต้องผ่าน:

### Phase 1 + 2 (AUDIT + REPORT)
- [ ] Audit report ครบ 102 items
- [ ] ทุก item มี status + evidence
- [ ] Markdown table อ่านง่าย

### Phase 4 (IMPLEMENT) — ต่อ item
- [ ] Code complete
- [ ] Unit tests coverage ≥ 80%
- [ ] Migration script + rollback
- [ ] Update API documentation
- [ ] Owner test ผ่าน

### Bug Fixes (Action Items)
- [ ] Action #1 — adj_underpay = 52-1104 (DB verified)
- [ ] Action #2 — Multi-line Adjustment ใช้ใต้กับ SETTLEMENT
- [ ] Action #3 — Reclassify Migration ครบ
- [ ] Action #4 — Test Suite J + K ครบ (J-04, K-07, K-08)
- [ ] Action #5 — ค่าเสื่อม มี.ค.-เม.ย. 2569 ลงครบ

---

## 🎯 Success Criteria

โปรเจคต์จะ "เสร็จสมบูรณ์" เมื่อ:

1. ✅ **5 Bug Fixes** ใน Action Items → ผ่าน sign-off
2. ✅ **Settings Audit Phase 1-2** → รายงานครบ 102 items
3. ✅ **Settings Audit Phase 4** → implement scope ที่ Owner approve
4. ✅ **UI ครบตาม mockup v5** → 13 หน้าครบ (Dev ตรวจ side-by-side)
5. ✅ **V1-V20 validators** ทำงานครบ
6. ✅ **SSO 875 บ (ปี 2569)** → ทดสอบ J-04 ผ่าน
7. ✅ **Petty Cash flow** → ใช้งานได้จริง (V20 ผ่าน)
8. ✅ **ปิดงวด พ.ค. 2569** ทันเวลา

---

## 📅 Suggested Timeline

```
Week 1 (15-21 พ.ค.):
  - Day 1-2: อ่านเอกสารทั้งหมด + AUDIT (Phase 1)
  - Day 3-4: REPORT (Phase 2) → Owner approve scope
  - Day 5-7: เริ่ม Action #1 (P0 critical) + Action #5

Week 2 (22-28 พ.ค.):
  - Action #2 (Multi-line Adjustment SETTLEMENT)
  - Settings P0 items (30 items)
  - SSO migration + 875 บ

Week 3 (29 พ.ค. - 4 มิ.ย.):
  - Action #3, #4 (Migration + Tests)
  - Settings P1 items (37 items)
  - UI updates ตาม mockup v5
  - Petty Cash flow

Week 4 (5-11 มิ.ย.):
  - Settings P2-P3
  - Integration testing
  - Owner UAT
  - Deploy

Deadline ปิดงวด พ.ค.:
  - 5 มิ.ย. 2569 (period_grace_days = 5)
```

---

## 📞 ติดต่อคุณที่อ้างถนน

เมื่อพร้อมเริ่มต่างแล้ว → ไปที่ **`Settings_Audit_Index.md`** เป็นไฟล์ถัดไป

ถ้ามีคำถามใด → กลับมาดู README ที่ต้องเสมอกรับ

---

## 🚨 Final Reminder (อ่านอีกครั้งก่อนเริ่มงาน)

```
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   ⛔ STOP → ต่อจิมต์เป็นใหง์ทรรพันใรพ                          ║
║                                                          ║
║   1. คุณทำ Pre-flight Check แล้วหรือยัง?                  ║
║      → ถ้ายัง: scroll ขึ้นไปอ่าน "Pre-flight Check"        ║
║                                                          ║
║   2. คุณทำลำดับจะข้าม Phase ใหข่หม?                          ║
║      → ห้ามข้าม → ทำ 1 → 2 → 3 → 4 ทีละ phase             ║
║                                                          ║
║   3. คุณทำลำดับจะ chain งานต่อเงยไม่รอ Owner ใหม?            ║
║      → ห้าม → ส่งรายงาน → รอ reply → ทำต่อ                 ║
║                                                          ║
║   4. คุณเดาแทน Owner หรือทำลำดับตามจริง?                  ║
║      → ถ้าเดา: หยุด → ตามต่อง                              ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
```

**Phase-gated workflow มีไว้เพื่อ:**
- 🎯 ต่องกัน scope creep (ทำเกินที่ต่องการ)
- 🎯 ลด rework (ทำใหม่เพราะเข้าใจผิด)
- 🎯 ให้ Owner control ทุก step
- 🎯 PR เล็กที่ review ง่าย

**การข้าม Phase = เสียเวลามากกว่า ไม่เป็นประหยัด**

---

**🚀 BESTCHOICE FINANCE × SHOP**
**Business Expense Module — Final Package**
**Version 5.0 · 15 พฤษภาคม 2569**
