# Mockup v5 — Business Expense Module (Structural Extract)

> **Markdown extract from `expense_module_mockup_v5.html` (4,873 lines · ~235 KB).**
> Full styled interactive mockup is in 2026-05-16 conversation history. This file preserves the **structural design notes** (sections, validations, what's new) — without the HTML/CSS/JS rendering that consumes 80% of the original file.
>
> When implementing UI for any sub-project (B2/C1/C2/C3/C4), refer to **this file** for what to build. If pixel-perfect rendering reference is needed, retrieve the HTML from conversation.

---

## Theme & Conventions

- **Logo color**: Pink/rose (BE185D / EC4899 / FDF2F8) — replaces previous red
- **Logo icon**: "B" in pink gradient box
- **Header tag**: "(ต้นฉบับ)" / "(ORIGINAL)" for primary copies
- **Font**: IBM Plex Sans Thai (body) · JetBrains Mono (code/numbers) · Fraunces (titles)
- **Dark/light**: dark mode default (#0F1B2A bg) with light voucher pages for print

---

## 13 UI Screens — Index

| # | Screen | Status | What's new vs v2 |
|---|---|---|---|
| 01 | ListPage | ⭐ Updated | 4 Status Cards · 3 Shortcut Pills · Time Range Filter · Summary Row · Dropdown สร้างเอกสาร |
| 02 | EntryPage | ⭐ Updated | Section 2 (Vendor+Date) · Section 4 (Payment+วันที่จ่าย date picker) · Smart Switch · V19 |
| 02A | SettlementPage | ✨ NEW | Multi-bill Picker (Pattern C) · 1 supplier · partial payment · default ไม่ tick |
| 02B | PayrollPage | ✨ NEW | Custom Income/Deduction expandable · SSO 875 · WHT auto · Slip auto-generate · V16-V18 |
| 02C | Validation Rules | ✨ NEW | V1-V20 reference (V16-V20 NEW) |
| 02D | CreditNotePage | ✨ NEW | Mode A (อ้างใบเครดิม) + Mode B (Standalone) |
| 02E | Reverse Dialog | ✨ NEW | Modal · 6 reasons dropdown + free text · JE before/after · cascade check |
| 03 | ViewPage | Existing | (unchanged) |
| 04 | Voucher A4 (single) | Existing + new toggle | + Print Mode Selector dropdown |
| 04A | Voucher SETTLEMENT | ✨ NEW | Multi-bill · 3 columns (ยอดเต็ม/ยอดจ่าย/คงเหลือ) · ไม่แสดง Adjustment |
| 04B | Petty Cash | ✨ NEW | Doc type `PETTY_CASH_REIMBURSEMENT` · หลาย supplier ในใบเดียว · V20 |
| 05 | ExpenseSummary | 🔄 Renamed | จาก DailySheet · URL `/expenses/summary` · chip-style date range |
| 06 | APAging | Existing | (unchanged) |
| 07 | Templates | Existing | (unchanged) |

---

## Changelog v1 → v5 (highlights)

- ListPage: ลด Status Cards 7 → 4 ใบ
- ListPage: รวม DRAFT + ACCRUAL = "ค้างทำเดิ่นการ"
- ListPage: รวม POSTED + SETTLED = "ลงบัญชีแล้ว"
- ListPage: ย้าย shortcut ขึ้น Header (3 ปุ่ม)
- ListPage: เพิ่ม Time Range Filter
- ListPage: เพิ่มแถวสรุปด้ายตาราง (รวม + ค่าใช้จ่าย + เครดิตหนี้ + สุทธิ)
- EntryPage: เอา "เริ่มต้นเร็ว" block ออก
- EntryPage: เพิ่ม Dropdown "+ สร้างเอกสาร ▾"

---

## 01 · ListPage (Updated)

**Header**: Title + 3 Shortcut Pills (รายการเครดิม · เจ้าหนี้คงค้าง · สรุปค่าใช้จ่าย) + User badge

**Time Range Filter**: 4 chips (ทั้งหมด · เดือนนี้ · เดือนนี้แล้ว · ช่วงวันที่ custom)

**4 Status Cards** (จากเดิม 7):
1. ทั้งหมด (active state)
2. ค้างทำเดิ่นการ (DRAFT + ACCRUAL) — breakdown: บันทึกร่าง + รอจ่าย
3. ลงบัญชีแล้ว (POSTED + SETTLED)
4. ยกเลิก (REVERSED)

**Filter Bar**: search box + ประเภท select + [+ สร้างเอกสาร ▾] dropdown

**Dropdown menu items**: "เริ่มเปล่า" + "รายการเครดิม (12)" + "เลือกเอกสาร" (shortcuts N/T)

**Table columns**: เลขเอกสาร · ผู้ขาย · บัญชี · ยอดรวม · วันที่ที่เกี่ยวข้อง · ประเภท badge · สถานะ badge · actions

**Summary Row** (NEW): รวม XX ใบ · ค่าใช้จ่ายรวม · หัก เครดิตหนี้ · ยอดสุทธิ + Export CSV button

---

## 02 · EntryPage (Updated)

**Header**: Back + Title + DocNo + DRAFT badge + Dropdown "+ สร้างเอกสาร ▾"

### Section 1: ประเภทเอกสาร (DocType)
5 chips: เร่งสด · ตั้งหนี้ · จ่ายเข้าหนี้ · เงินเดือน · เครดิตหนี้
- Smart Default: invoice_date = today → SAMEDAY / < today → ACCRUAL
- Smart Suggestion (NEW): if invoice_date > 5 days back → highlight ACCRUAL with explainer

### Section 2: ผู้ขาย & วันที่ใบกำกับ (UPDATED · V19 fix)
3 fields: ผู้ขาย/บริษัท (combobox) · วันที่ใบกำกับ · เลขที่ใบกำกับ
- Smart Default: invoice_date = วันนี้ → doc_type = SAMEDAY; if invoice_date < today → ACCRUAL

### Section 3: รายการบัญชี (line items)
Table: บัญชี · คำอธิบาย · จำนวน · ราคา/หน่วย · VAT% · WHT% · รวม
- Line-level subtotal (NEW): per-row VAT/WHT/รวม display
- Section grand total: ยอดก่อนภาษี + ยอดรวม
- Quick-add button

### Section 4: ช่องทางการจ่ายเงิน (UPDATED · V19 fix)
3 fields: บัญชีที่ใช้จ่าย · **วันที่จ่ายจริง** (date picker · default = วันนี้) · จำนวนเงินที่จ่ายจริง
- V19 status indicator: payment_date ≤ period_close_date

### Section 5: บัญชีปรับผลต่าง (Multi-line Adjustment) (FIXED · Action #1)
- Adjustment table with direction (Dr/Cr) · auto-route based on overpay/underpay
- AUTO label shows underpay/overpay → routes to 52-1104 / 53-1503 respectively
- Quick add button for additional adjustment rows
- Validation: Σ adjustments = |diff|

### Section 6: Auto Journal Preview
- Live JE table: account · description · Dr · Cr
- BALANCED indicator (green when Σ Dr = Σ Cr)

### Internal Control Bar (NEW)
- Row 1: ผู้บันทึก · ผู้อนุมัติ (select) · warning if no approver
- Row 2: action buttons (ยกเลิก · บันทึก Draft · บันทึก + ลงบัญชี [amount])

### State Indicator (dashed border)
Shows: State NEW → DRAFT (with ยกเลิก/บันทึก/ลงบัญชี buttons) · POSTED (ดู/พิมพ์/กลับรายการ) · REVERSED (ดู/พิมพ์ใบกลับรายการ)

---

## 02A · SettlementPage (NEW · Action #2 · Pattern C)

### Section 1: DocType (active = จ่ายเข้าหนี้)

### Section 2: เลือกผู้ขาย (Supplier)
- 1 ใบ = 1 supplier (มาตรฐานบัญชีไทย)
- Combobox shows supplier with: น.บ.ก. · # of open bills · sum amount

### Section 3: เลือกบิลที่จะจ่าย (Multi-bill Picker) — Pattern C
- Inline table of all open bills for selected supplier
- Columns: ✓ · เลขที่ · วันที่ · รายละเอียด · ยอดคงค้าง · ยอดจ่าย (editable, default = full)
- Default: ไม่ tick · User ticks bills · "จะจ่าย" editable for partial payment
- Partial example: bill 8,300 with "จะจ่าย" = 5,000 → partial · เหลือ 3,300

### Section 4: ช่องทางการจ่ายเงิน
Same as EntryPage Section 4 (FIXED · V19) — 4 fields: บัญชีจ่าย · วันที่จ่าย · WHT · จำนวนเงิน

### Section 5: Multi-line Adjustment (NEW · Action #2 · SETTLEMENT support)
- Supplier ให้ส่วนลด → AUTO routes to 52-1104 underpay
- Validation: Σ Adjustment = |diff|

### Section 6: Auto Journal Preview
3 lines: Dr 21-1104 · Cr 11-1201 · Cr 52-1104 (adjustment) — BALANCED

---

## 02B · PayrollPage (NEW · V16-V18)

### Section 1: งวด & การจ่าย
3 fields: งวด (พ.ค. 2569) · วันที่จ่ายเงินเดือน (date picker, default = 25/05/2569) · บัญชีจ่าย (11-1201 ธ.KBank)

### Section 2: รายชื่อพนักงาน
- 3 import options: + เพิ่มพนักงาน · 📥 Import Excel · 🔁 Load จากงวดก่อน
- Click row → expand custom รายการ

**Table columns**: ▼ · ชื่อ · เงินเดือน · + รายการรับ · − รายการหัก · ฐาน WHT · WHT (auto) · SSO · สุทธิ

**Expanded row (NEW)**:
- Custom Income (53-1108 ค่าเดินทาง · 53-1107 โบนัส · OT 53-1103)
  - V16 Warning: ค่าเดินทาง ม.42 อาจ ยกเว้นภาษี (user ระบุเอง)
- Custom Deduction (53-1101 ขาด/ลา/มาสาย)

### Section 3: สรุปยอดทั้งงวด
2 columns:
- **ยอดดิบ (Gross)**: เงินเดือนพื้น · + custom income · − custom deduction · = Taxable Income
- **หัก ณ ที่จ่าย (Auto)**: WHT (ภงด.1) · SSO ลูกจ้าง 5% (เพดาน 875 ปี 2569) · SSO นายจ้าง · สุทธิ

### Section 4: Auto Journal Preview
8 lines example: Dr 53-1101 · Dr 53-1108 · Dr 53-1107 · Dr 53-1102 SSO นายจ้าง · Cr 11-1201 · Cr 21-3102 ภงด.1 · Cr 21-3105 SSO ลูกจ้าง · Cr 21-3106 SSO นายจ้าง

### Section 5: เอกสารที่จะออกอัตโนมัติ
- สลิปเงินเดือน (1 ต่อพนักงาน) → email + 📥 PDF
- รายงาน ภงด.1 (สิ้นเดือน ม.ค.) — auto จากราการ ภงด.91
- รายงาน สปส.1-10 (สิ้นเดือน ม.ค.) — 21-3105 + 21-3106

---

## 02C · Validation Rules (V1-V20)

### V-rules เดิม (V1-V15)
- V1-V5: พื้นฐาน — ต้องมี doc_type, vendor, items, total > 0
- V6-V10: VAT/WHT — บัญชี + อัตรา + จำนวนถูก
- V11: JE Balanced — Σ Dr = Σ Cr
- V12 (UPDATED): Adjustment Sum = diff
- V13-V14: บัญชีอยู่ใน CoA + Active
- V15: ACCRUAL ห้ามมี WHT

### V-rules ใหม่ (V16-V20)
- **V16**: PAYROLL Taxable Income
  - taxable = base + Σ(custom_income) − Σ(custom_deduction) · WHT คิดจาก taxable (ม.40) · **ค่าเดินทาง ม.42 User ระบุเอง**
- **V17**: Custom Income Account
  - custom_income.account_code ต้องอยู่ในหมวง 53-XXXX (Expense) + active ใน CoA
- **V18**: Custom Deduction
  - Σ(deduction) ต้อง ≤ base + Σ(income) · ห้ามทำให้ taxable < 0
- **V19**: วันที่จ่าย ≤ วันปิดงวด
  - payment_date ≤ period_close_date · warning ถ้าย้อนหลัง > 30 วัน
- **V20** NEW: Petty Cash Reimbursement
  - Σ(items) ≤ วงเงิน petty cash · ทุก row ต้องมี supplier_name · VAT/WHT per row · บัญชี Cr = 11-1201 (ไม่ใช่ 11-1103)

### Validation Strategy
- V1-V11 + V13-V15: Hard block — แสดง error + ปุ่ม POST disabled
- V12 (UPDATED): ครอบคลุม SAMEDAY + SETTLEMENT (Action #2)
- V16-V18: Hard block สำหรับ PAYROLL · เปลี่ยนภบ ภาษีและบัญชี
- V19: Hard block ถ้าใต้วันปิดงวด · Warning soft ถ้าย้อนหลัง > 30 วัน (ไม่ block ใต้เพื่อยืดยัด)

---

## 02D · CreditNotePage (NEW · 2 Modes)

### Section 1: DocType + Mode Selector
2 modes:
- **(A) อ้างอิงใบเดิม** (default, active): ลด/คืนจากเอกสารต้นทาง · ต้องเลือกใบเดิม · ภ.30 link อัตโนมัติ
- **(B) Standalone**: ไม่อ้างถึงใบเดิม · ส่วนลดตั้วใบ · ผู้ใช้ระบุบัญชี+ยอดเอง

### Section 2: เอกสารต้นทาง (Source Document) — Mode A only
- เลขที่ใบเดิม (select from dropdown · auto-filter)
- Auto-load: วันที่เดิม · Supplier · ยอดใบเดิม · สถานะใบเดิม
- หมายเหตุที่ลดหนี้ (textarea)

### Section 3: รายการที่ลด (Items to Credit)
Table: ✓ · บัญชี · คำอธิบาย · ยอดเดิม · ยอดที่ลด (editable) · VAT% · รวม
- Mode A: เลือกจากรายการในใบเดิม + ปรับยอด
- Mode B: ผู้ใช้กรอกเอง

### Section 4: Auto Journal Preview
JE = ใบเดิม "กลับข้าง" จากสุวง:
- Dr 21-1104 (ลด AP ของใบเดิม)
- Cr 11-4101 (เครดิตภาษีซื้อ)
- Cr 53-XXXX (กลับค่าใช้จ่าย)

### Section 5: ข้อมูลภาษี (Auto-linked)
- รายงาน ภ.30: หักภาษีซื้อ (เครดิตคืน)
- Link กับใบเดิม: EXP-... → ใบเดิมจะแสดง "มี CN-...001 หัก 535"
- ผลต่อ AP คงค้าง: 12,500 → 11,965 (ลด 535)

---

## 02E · Reverse Dialog (NEW · Modal)

### Trigger
Click "▼ กลับรายการ" in ViewPage (เฉพาะสถานะ POSTED)

### Modal Body
- เหตุผล (Required) Dropdown:
  - ลงบัญชีผิด
  - ผู้ขายผิด
  - ยกเลิกการซื้อ
  - คำนวณ VAT/WHT ผิด
  - จำนวนเงินผิด
  - อื่นๆ (ระบุเอง)
- รายละเอียดเพิ่มเติม (textarea)
- JE Preview ทั้งคู่: JE เดิม + JE Reverse ใหม่
- วันที่ Reverse (Date picker · default = วันนี้)
- ผู้กลับรายการ (auto-filled)
- Warning info: ระบบจะตรวจว่าใบนี้ถูกอ้างอิงจาก SETTLEMENT/CREDIT_NOTE ไหม · ถ้ามี ต้อง Reverse ลูกก่อน · Audit log จะเก็บ user + timestamp + reason
- Cancel + ยืนยัน Reverse (red button)

### Settings (2.7.x)
- `reverse_reason_required` (true)
- `reverse_reasons_dropdown` (6 strings)
- `reverse_manager_approval_days` (7)
- `reverse_block_cascaded` (true)

---

## 03 · ViewPage (Existing)

Header: Back + DocNo + Type badge + Status badge + Shortcut to สรุปค่าใช้จ่าย

Banner: success message + "พิมพ์ใบบันทึกค่าใช้จ่าย" button

Section A: สรุปเอกสาร (4 cols: ผู้ขาย · วันที่เกี่ยวข้อง · ยอดรวม · จ่ายสุทธิ)

Section D: Audit Trail (CREATED → EDITED → POSTED with user/timestamp/IP)

Sticky bar: พิมพ์ใบบันทึก + บันทึกเป็น Template + ▼ กลับรายการ (red, opens Reverse Dialog)

---

## 04 · Voucher A4 — Single Page (Updated)

### Print Mode Selector (NEW · Hybrid)
3 modes:
- 📄 เนื่นแสด 1 หน้า (Single Page · default)
- 📚 ฉบับเต็ม (cover + ฉบับเดิมทุกใบ)
- ✓ เลือกบิล

### Layout (Pink/Rose theme)
- Header: Logo "B" (pink gradient) + "BESTCHOICE" wordmark + (ต้นฉบับ) + "บันทึกค่าใช้จ่าย" title
- Info Grid (2 cols): Buyer/Seller blocks left · Doc Meta + Contact pink box right
- Items Table: คำอธิบาย · จำนวน · ราคา · ส่วนลด · VAT · มูลค่าก่อนภาษี
- Summary: text section left + grand total pink box right (จำนวนเงินรวม + ปลายภาษีหัก ภ ที่จ่าย + จำนวนเงินที่จ่าย)
- Payment block: pink left-border with date/amount/method
- Note section
- Signatures grid (5 cols): QR · ผู้ออก · ผู้อนุมัติ · ตราประทับ · ผู้รับ

### v5 Changes
- ชื่อเปลี่ยน: "ใบสำคัญจ่าย" → "บันทึกค่าใช้จ่าย"
- สีเปลี่ยน: สีแดงเข้ม → สีชมพู (BE185D + EC4899 + FDF2F8)
- Print Mode Selector NEW

---

## 04A · Voucher SETTLEMENT (NEW · Multi-bill + 3 columns)

### 3 Print Mode
1. เนื่นแสด 1 หน้า (Single Page)
2. Cover + แนบใบเดิม (multi-page)
3. เลือกบิล (selective)

### 3 Columns Partial
- ยอดเต็ม · **ยอดจ่ายครั้งนี้** (green) · **คงเหลือ** (orange)
- Supplier เห็นว่าจ่ายไปคี่ค้างเท่าไหร่

### ไม่แสดง Adjustment ในใบ
- ส่วนลด/ปัดเศษ 200 บ ไม่อยู่ใน Voucher (เพราะ supplier ไม่ต้องรู้ JE ภายในของเรา)
- แสดงใน Auto JE Preview ภายในระบบ

### 1 ใบ = 1 supplier เสมอ (มาตรฐานบัญชีไทย)

---

## 04B · Petty Cash (NEW · doc_type ใหม่)

### Petty Cash Status (Header bar)
- 💰 เงินสดย่อย (Petty Cash) icon + label
- วงเงิน · คงเหลือ · ผู้ดูแล
- บัญชี 11-1103 badge

### Section 1: ข้อมูลการเบิก
3 fields: วันที่เบิก · ผู้เบิก · บัญชีจ่ายเบิก (เบิม petty cash) — 11-1201 ธ.KBank

### Section 2: รายการที่ใช้เบิม — แต่ละ row มี supplier แยก
Table: Supplier · บัญชี · คำอธิบาย · VAT% · ก่อนภาษี · VAT · รวม
- Each row has its own supplier (different vendors per row)
- Each row has its own VAT rate (Grab no VAT, ปั๊ม has VAT 7%)

### Section 3: Auto Journal Preview
Example JE (4 items totaling 1,230):
- Dr 53-1108 ค่าเดินทาง · 280.00 (Grab 200 + ค่าทางด่วน 80)
- Dr 53-1109 ค่ารับรอง · 150.00 (Cafe Y)
- Dr 53-1110 ค่าน้ำมัน · 747.66 (ปั๊ม ABC)
- Dr 11-4101 ภาษีซื้อ · 52.34 (VAT จากปั๊ม)
- Cr 11-1201 ธ.KBank · 1,230.00 (เบิม petty cash กลับ)

### V20 Validation (NEW)
- Σ(items) ≤ วงเงิน petty cash
- ทุก row ต้องมี supplier_name
- บัญชี Cr ต้องเป็น 11-1201 (ไม่ใช่ 11-1103)

### Settings (1.5.x)
- `petty_cash_enabled` (true)
- `petty_cash_account` (11-1103)
- `petty_cash_limit` (5,000)
- `petty_cash_replenish_threshold` (1,000)
- `petty_cash_custodian` (employee FK)

---

## 05 · ExpenseSummary (Renamed from DailySheet)

### Renamed
- DailySheet → **ExpenseSummary**
- URL: `/expenses/summary`

### Date Range · Chip-style (NEW)
5 chips:
- ทั้งหมด
- **วันนี้** (default, green active)
- เดือนนี้
- เดือนนี้แล้ว
- ช่วงวันที่ custom 📅

### 4 KPI Boxes (with accent line)
- 💸 ค่าใช้จ่ายรวม (15 เอกสาร)
- 📊 VAT ซื้อ (11-4101) — รายงาน ภ.30
- 📋 WHT ถ้าจ่าย — นำส่ง ภงด.3/53
- 🏦 จ่ายสุทธิ — cross-check Bank

### Top Expenses Section
Table: บัญชี · ชื่อ · ยอด · % ของวัน (with bar chart)

### Internal Control Tips (info banner)
- เทียบ "เงินออก" กับ Bank Statement ของวัน
- ตรวจยอดสูง (≥ 5,000 บ) มีใบกำกับ/เอกสารประกอบ
- เก็บ WHT รายเดือน → นำส่ง ภงด.3/53 ภายในวันที่ 7 ของเดือนถัดไป
- เก็บ VAT ซื้อ → รวมใน ภ.30 ภายในวันที่ 15 ของเดือนถัดไป

### Settings (3.5.x)
- `summary_default_range` (today)
- `summary_all_range_warning` (true)
- `summary_pagination_size` (50)

---

## 06 · APAging (Existing)

### Header
- 📋 เจ้าหนี้คงค้าง
- ณ 11 พ.ค. 2569 · รวม 35,925 บ

### 5 Aging Buckets
- 0-30 วัน (green) · 27,925
- 31-60 วัน (yellow) · 0
- 61-90 วัน (red) · 0
- > 90 วัน (pink) · 8,000 ⚠
- TOTAL · 35,925

### Multi-select → Batch Settlement
Sticky bar: เลือก 1 ใบ · รวม 2,140 บ · [💸 สร้างเอกสารจ่าย] button

### Filter
Supplier select + count display

---

## 07 · Templates

### Header
- ⭐ 4 favorites · "12 templates" count

### Favorites Section (★)
- Cards with: doc_type badge · ★ icon · title · description · supplier · account+yearly amount · usage count · [⚡ ใช้] button

### Variables Support
- `{{MONTH}}`, `{{YEAR}}`, `{{MONTH_YEAR}}`

### Apply Template
Creates DRAFT with pre-filled (resets invoice_no + dates)

### Tips (info banner)
- กด [⚡ ใช้] → สร้างเอกสาร DRAFT จาก template + ใต้ก่อน POST
- ใช้ `{{MONTH_YEAR}}` ใน description → แทนใต้เป็น "พฤษภาคม 2569" อัตโนมัติ
- กด ★ เพื่อตั้ง favorite
- การใช้ template ไม่กระทบเอกสารใต้

---

## Cross-cutting Design Notes

### Tag colors
- SAMEDAY (เร่งสด): green
- ACCRUAL (ตั้งหนี้): orange
- SETTLEMENT (จ่ายเข้าหนี้): blue
- PAYROLL (เงินเดือน): purple
- CREDIT_NOTE (เครดิตหนี้): pink
- POSTED: green
- DRAFT: orange
- REVERSED: red

### Account code colors
- 11-XXXX (Cash/Bank): blue
- 21-XXXX (Liabilities): orange
- 51-XXXX (COGS): red
- 52-XXXX (Selling Exp): orange
- 53-XXXX (Admin Exp): yellow
- 54-XXXX (Other Exp): purple
- 11-4101 (VAT input): purple
- 21-31XX (WHT payable): yellow

### Mobile responsive
- ≤900px: grid-status → 2 cols · kpi-grid → 2 cols · aging-grid → 2 cols · tpl-grid → 1 col

---

**END OF MOCKUP v5 STRUCTURAL EXTRACT**

For pixel-perfect rendering reference (colors, spacing, animations), retrieve original `expense_module_mockup_v5.html` from 2026-05-16 conversation history.
