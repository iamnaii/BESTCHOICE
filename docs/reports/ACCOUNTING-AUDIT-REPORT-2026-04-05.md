# รายงานผลตรวจสอบระบบบัญชี BESTCHOICE

**วันที่ตรวจสอบ:** 5 เมษายน 2569 (2026-04-05)
**ผู้ตรวจสอบ:** AI Auditor (Claude) — ตรวจตามหลักบัญชีไทยและมาตรฐานที่ระบุใน ACCOUNTING-AUDIT-PROMPT.md
**ขอบเขต:** 12 หมวดการตรวจสอบ ครอบคลุม source code ทั้ง backend (NestJS + Prisma) และ frontend (React)

---

## สรุปผลรวม

| # | หมวด | สถานะ | วิกฤต (C) | เตือน (W) | ข้อเสนอแนะ (R) |
|---|------|--------|:---------:|:---------:|:--------------:|
| 1 | ผังบัญชี (Chart of Accounts) | **FAIL** | 1 | 1 | 1 |
| 2 | รับรู้รายได้ (Revenue Recognition) | **PASS** | 0 | 1 | 1 |
| 3 | ภาษีมูลค่าเพิ่ม (VAT) | **FAIL** | 1 | 1 | 1 |
| 4 | ภาษีหัก ณ ที่จ่าย (WHT) | **FAIL** | 1 | 1 | 1 |
| 5 | ลูกหนี้เช่าซื้อ & หนี้สงสัยจะสูญ | **FAIL** | 1 | 2 | 1 |
| 6 | ใบเสร็จ / ใบกำกับภาษี | **PARTIAL** | 1 | 2 | 2 |
| 7 | ต้นทุนขาย (COGS) | **PARTIAL** | 1 | 1 | 1 |
| 8 | ค่าใช้จ่าย & Workflow อนุมัติ | **PARTIAL** | 1 | 1 | 1 |
| 9 | บัญชีระหว่างกัน (Inter-Company) | **PARTIAL** | 0 | 2 | 2 |
| 10 | รายงานทางการเงิน | **PARTIAL** | 1 | 2 | 1 |
| 11 | การชำระเงินและการจัดสรร | **PASS** | 0 | 0 | 1 |
| 12 | Audit Trail & การควบคุมภายใน | **PARTIAL** | 0 | 2 | 2 |
| | **รวม** | | **8** | **16** | **15** |

**สรุป: FAIL — พบประเด็นวิกฤต 8 รายการที่ต้องแก้ไขก่อนใช้งานจริงในเชิงบัญชีภาษี**

---

## ประเด็นวิกฤต (Critical) — ต้องแก้ไขทันที

### [C-001] ผังบัญชีไม่ครบ 5 หมวด — มีเฉพาะค่าใช้จ่าย (5xxx)
- **หมวด**: 1 — ผังบัญชี
- **ไฟล์**: `apps/api/src/modules/accounting/accounting.service.ts:11-43`
- **ปัญหา**: ระบบกำหนดเฉพาะ `CATEGORY_ACCOUNT_MAP` และ `CATEGORY_CODE_MAP` สำหรับค่าใช้จ่าย (5xxx) เท่านั้น ไม่มีบัญชีหมวด 1xxx (สินทรัพย์), 2xxx (หนี้สิน), 3xxx (ส่วนของเจ้าของ), 4xxx (รายได้)
- **มาตรฐานที่ขัด**: กรมพัฒนาธุรกิจการค้า — ผังบัญชีมาตรฐาน SMEs ต้องครบ 5 หมวด
- **ความเสี่ยง**: ไม่สามารถสร้างงบการเงินที่ถูกต้องตามกฎหมาย (งบดุล, งบกำไรขาดทุน) ได้ เนื่องจากไม่มีบัญชีสินทรัพย์/หนี้สิน/ทุน/รายได้อย่างเป็นทางการ
- **บัญชีที่ขาด**:
  - 1100 ลูกหนี้การค้า, 1150 ลูกหนี้เช่าซื้อ, 1200 สินค้าคงเหลือ, 1300 ภาษีซื้อ
  - 2100 ภาษีขาย, 2110 ภาษีมูลค่าเพิ่มค้างจ่าย
  - 3xxx ทุน/กำไรสะสม
  - 4100 รายได้จากการขาย, 4400 รายได้ดอกเบี้ย, 4500 รายได้ค่าปรับ
  - 1110 ค่าเผื่อหนี้สงสัยจะสูญ, 5800 หนี้สูญ
- **แนวทางแก้ไข**: สร้างตาราง `ChartOfAccount` ใน Prisma schema พร้อม seed ผังบัญชีครบ 5 หมวด และเชื่อมกับทุก transaction

---

### [C-002] VAT คำนวณรวมดอกเบี้ยเช่าซื้อ — ผิดกฎหมายภาษี
- **หมวด**: 3 — VAT
- **ไฟล์**: `apps/api/src/utils/installment.util.ts:54`
- **ปัญหา**: สูตร VAT คำนวณจาก `(principal + storeCommission + interestTotal) × vatPct` — **รวมดอกเบี้ยเช่าซื้อในฐาน VAT**
- **มาตรฐานที่ขัด**: ประมวลรัษฎากร มาตรา 81(1)(ช) — ดอกเบี้ยเช่าซื้อ **ได้รับยกเว้น VAT**
- **ความเสี่ยง**:
  - ลูกค้าถูกเรียกเก็บ VAT เกินจริง (ตัวอย่าง: principal 10,000 + commission 1,000 + interest 1,500 → VAT เกิน 105 บาท/รายการ)
  - อาจถูกสรรพากรเรียกคืนภาษีขายที่เก็บเกิน
  - เป็นความเสี่ยงทางกฎหมายต่อลูกค้าทุกราย
- **แนวทางแก้ไข**: แก้สูตรเป็น `vatAmount = roundBaht((principal + storeCommission) * vatPct)` — ตัด interestTotal ออกจากฐาน VAT

---

### [C-003] ระบบภาษีหัก ณ ที่จ่ายไม่สมบูรณ์ — ไม่สามารถยื่น ภ.ง.ด.3/53 ได้
- **หมวด**: 4 — WHT
- **ไฟล์**: `apps/api/src/modules/accounting/accounting.service.ts:78`, `apps/api/src/modules/accounting/dto/expense.dto.ts`
- **ปัญหา**:
  1. ไม่มีการ validate อัตราภาษีหัก ณ ที่จ่าย (1%, 2%, 3%, 5%) — รับค่า arbitrary
  2. ไม่มี field ประเภทเงินได้ (income type) สำหรับจำแนก WHT
  3. ไม่มีรายงานสรุป WHT รายเดือน (ภ.ง.ด.3, ภ.ง.ด.53)
  4. ไม่มี field อัตราภาษี (`whtRate`), เลขประจำตัวผู้เสียภาษีผู้รับ
  5. `totalAmount` ไม่หัก WHT ออก → ยอดจ่ายจริงไม่ถูกต้อง
- **มาตรฐานที่ขัด**: ประมวลรัษฎากร มาตรา 3 เตรส, 50, 69 ทวิ
- **ความเสี่ยง**: ไม่สามารถยื่นแบบภาษีหัก ณ ที่จ่ายรายเดือนตามกฎหมาย → อาจถูกปรับ
- **แนวทางแก้ไข**:
  1. เพิ่ม fields ใน Expense: `whtRate`, `whtIncomeType`, `payeeTaxId`
  2. คำนวณ: `netPayment = amount + vatAmount - withholdingTax`
  3. สร้าง report service สำหรับ ภ.ง.ด.3 (บุคคลธรรมดา) และ ภ.ง.ด.53 (นิติบุคคล)

---

### [C-004] ไม่มีระบบตั้งสำรองหนี้สงสัยจะสูญ
- **หมวด**: 5 — ลูกหนี้เช่าซื้อ
- **ไฟล์**: `apps/api/src/modules/reports/reports.service.ts:15-59`
- **ปัญหา**: Aging Report มี bucket (1-30, 31-60, 61-90, 90+) แต่ **ไม่มีการตั้งค่าเผื่อหนี้สงสัยจะสูญ** (Allowance for Doubtful Accounts) ตามอายุหนี้ นอกจากนี้:
  - Contract มี status `CLOSED_BAD_DEBT` แต่ไม่มี service/method สำหรับ write-off ทางบัญชี
  - ไม่มีบันทึกรายการบัญชี (journal entry) เมื่อตัดหนี้สูญ
  - ไม่มีกระบวนการอนุมัติการตัดหนี้สูญ
- **มาตรฐานที่ขัด**: TFRS 9 (เครื่องมือทางการเงิน), TAS — ต้องประมาณการผลขาดทุนจากลูกหนี้
- **ความเสี่ยง**: งบการเงินแสดงลูกหนี้สูงเกินจริง (overstatement of receivables)
- **แนวทางแก้ไข**:
  1. เพิ่มอัตราตั้งสำรองตามอายุหนี้ (configurable)
  2. สร้าง Bad Debt Write-off service พร้อม approval workflow
  3. บันทึก journal entry: เดบิตหนี้สูญ / เครดิตค่าเผื่อฯ

---

### [C-005] ใบเสร็จ/ใบกำกับภาษีขาดข้อมูลตามกฎหมาย
- **หมวด**: 6 — ใบเสร็จ
- **ไฟล์**: `apps/api/src/modules/receipts/receipts.service.ts`, `apps/api/prisma/schema.prisma` (Receipt model)
- **ปัญหา**:
  1. ไม่มีข้อมูลที่อยู่/เลขประจำตัวผู้เสียภาษีของผู้ซื้อบนใบเสร็จ
  2. ไม่มี itemized line items (รายละเอียดสินค้า, จำนวน, ราคาต่อหน่วย)
  3. ไม่มี VAT breakdown (ราคาก่อน VAT / VAT / รวม VAT) บนใบเสร็จ
  4. การ Void ไม่มี approval workflow — user คนใดก็ void ได้
  5. CompanyInfo เป็น optional → อาจออกใบเสร็จโดยไม่มีข้อมูลผู้ออก (fallback เป็น hardcoded)
- **มาตรฐานที่ขัด**: ประมวลรัษฎากร มาตรา 86/4 (ข้อมูลใบกำกับภาษี), พ.ร.บ.การบัญชี พ.ศ. 2543
- **ความเสี่ยง**: ใบเสร็จไม่สามารถใช้เป็นใบกำกับภาษีได้ → ลูกค้านิติบุคคลไม่สามารถนำไปขอคืน VAT
- **แนวทางแก้ไข**:
  1. เพิ่ม fields ใน Receipt: `buyerAddress`, `buyerTaxId`, line items, VAT detail
  2. บังคับ CompanyInfo ก่อนออกใบเสร็จ
  3. เพิ่ม Void approval workflow (ต้องได้รับอนุมัติจาก OWNER/ACCOUNTANT)

---

### [C-006] ต้นทุน Bundle Products ไม่ถูกรวมใน COGS
- **หมวด**: 7 — COGS
- **ไฟล์**: `apps/api/src/modules/sales/sales.service.ts:177-201`, `apps/api/src/modules/accounting/accounting.service.ts:436`
- **ปัญหา**: เมื่อขายสินค้าพร้อม bundle/freebie:
  - สินค้า bundle ถูก mark เป็น `SOLD_CASH` (line 199)
  - แต่ **costPrice ของ bundle ไม่ถูกรวมใน COGS calculation**
  - P&L `purchaseOrderCost` คำนวณเฉพาะ `s.product.costPrice` ของสินค้าหลัก
  - ตัวอย่าง: สินค้าหลัก cost 5,000 + bundle cost 2,000 → COGS ควรเป็น 7,000 แต่ระบบบันทึก 5,000
- **มาตรฐานที่ขัด**: TAS 2 (สินค้าคงเหลือ) — ต้นทุนที่เกี่ยวข้องกับการขายต้องบันทึกเป็น COGS ทั้งหมด
- **ความเสี่ยง**: COGS ต่ำเกินจริง → กำไรขั้นต้นสูงเกินจริง (overstatement of gross profit)
- **แนวทางแก้ไข**: รวม costPrice ของ bundleProductIds ทั้งหมดเข้าใน COGS calculation ของแต่ละรายการขาย

---

### [C-007] ค่าใช้จ่าย Void ไม่มี reason และ approval trail
- **หมวด**: 8 — ค่าใช้จ่าย
- **ไฟล์**: `apps/api/src/modules/accounting/accounting.service.ts:277-284`
- **ปัญหา**:
  1. `voidExpense()` ไม่บันทึกเหตุผลการยกเลิก (ไม่มี `voidReason` field)
  2. ไม่มี `voidApprovedBy` / `voidApprovedAt` — ไม่มี audit trail ว่าใครอนุมัติ
  3. Schema มี `rejectReason` แต่ไม่มี `voidReason` แยกต่างหาก
- **มาตรฐานที่ขัด**: พ.ร.บ.การบัญชี พ.ศ. 2543 — ทุกรายการยกเลิกต้องมีเหตุผลและผู้อนุมัติ, COSO Framework
- **ความเสี่ยง**: ไม่สามารถตรวจสอบย้อนหลังได้ว่า ค่าใช้จ่ายถูกยกเลิกเพราะอะไรและใครอนุมัติ
- **แนวทางแก้ไข**:
  1. เพิ่ม fields: `voidReason`, `voidedById`, `voidedAt` ใน Expense model
  2. บังคับให้ระบุ reason เมื่อ void
  3. เก็บ audit trail ของ void action

---

### [C-008] ขาดงบดุล (Balance Sheet) และงบกระแสเงินสด (Cash Flow Statement)
- **หมวด**: 10 — รายงานทางการเงิน
- **ไฟล์**: `apps/api/src/modules/accounting/accounting.service.ts`, `apps/api/src/modules/reports/reports.service.ts`
- **ปัญหา**: ระบบมีเฉพาะ P&L Report และ Monthly Summary — **ไม่มีงบดุลและงบกระแสเงินสด**
- **มาตรฐานที่ขัด**: พ.ร.บ.การบัญชี พ.ศ. 2543, TFRS for NPAEs — ต้องจัดทำงบการเงินครบชุด
- **ความเสี่ยง**: ไม่สามารถยื่นงบการเงินตามที่กฎหมายกำหนด (ยื่นกรมพัฒนาธุรกิจการค้าภายใน 5 เดือนหลังปิดรอบบัญชี)
- **แนวทางแก้ไข**: สร้างงบดุล (ต้องมีผังบัญชีครบก่อน — เชื่อมกับ C-001) และงบกระแสเงินสด

---

## ประเด็นเตือน (Warning) — ควรแก้ไข

### [W-001] ไม่มีบัญชี Input VAT / Output VAT แยกต่างหาก
- **หมวด**: 1, 3
- **ไฟล์**: `apps/api/src/modules/accounting/accounting.service.ts`, `apps/api/prisma/schema.prisma`
- **ปัญหา**: VAT ถูก track ใน field ของ Expense/InterCompanyTransaction แต่ไม่มีบัญชีภาษีซื้อ (1300) / ภาษีขาย (2100) แยก → ไม่สามารถกระทบยอด VAT สำหรับการยื่น ภ.พ.30 ได้
- **แนวทางแก้ไข**: สร้าง VAT ledger accounts เมื่อ implement ผังบัญชีครบ (เชื่อมกับ C-001)

### [W-002] Revenue recognition: ดอกเบี้ยรับรู้แบบ straight-line ไม่ใช่ effective interest rate
- **หมวด**: 2
- **ไฟล์**: `apps/api/src/modules/accounting/accounting.service.ts:424`
- **ปัญหา**: `interestIncome += interestTotal / totalMonths` — แบ่งเฉลี่ยเท่ากันทุกเดือน (straight-line) ซึ่งไม่ตรงตาม TFRS 9 ที่แนะนำ effective interest rate method
- **หมายเหตุ**: สำหรับ NPAEs (กิจการ SME) straight-line อาจยอมรับได้ แต่ควร document ว่าเลือกใช้วิธีนี้โดยเจตนา
- **แนวทางแก้ไข**: Document นโยบายบัญชีว่าใช้ straight-line method สำหรับ flat-rate hire-purchase

### [W-003] ลูกหนี้เช่าซื้อไม่แสดงเป็น Gross - Unearned Interest = Net
- **หมวด**: 5
- **ไฟล์**: `apps/api/src/modules/contracts/contract-payment.service.ts:44-46`
- **ปัญหา**: ระบบคำนวณ `truePrincipal = financedAmount - interestTotal` แต่ไม่มีการแสดงลูกหนี้ในรูปแบบ: ลูกหนี้รวม - ดอกเบี้ยรอรับรู้ = มูลค่าสุทธิ ตามมาตรฐาน
- **แนวทางแก้ไข**: เพิ่ม field `unearnedInterest` หรือสร้าง report view ที่แสดงลูกหนี้สุทธิ

### [W-004] Credit Balance ไม่จำแนกเป็นหนี้สินหมุนเวียน
- **หมวด**: 5
- **ไฟล์**: `apps/api/prisma/schema.prisma` (Contract.creditBalance)
- **ปัญหา**: เงินเกินของลูกค้า (creditBalance) ถูกเก็บใน Contract model แต่ไม่จำแนกเป็นเจ้าหนี้/หนี้สินหมุนเวียน ไม่แสดงใน Balance Sheet
- **แนวทางแก้ไข**: จำแนก credit balance เป็นหนี้สินหมุนเวียนในงบดุล (เชื่อมกับ C-008)

### [W-005] ใบเสร็จ Void ไม่ set deletedAt — ยังปรากฏใน queries
- **หมวด**: 6
- **ไฟล์**: `apps/api/src/modules/receipts/receipts.service.ts:361`
- **ปัญหา**: Void ใช้ `isVoided: true` แต่ไม่ set `deletedAt` → receipt ที่ void แล้วยังปรากฏใน queries ที่ filter `deletedAt: null`
- **แนวทางแก้ไข**: ใช้ dual mechanism: `isVoided` สำหรับ display + `deletedAt` สำหรับ query filtering, หรือเพิ่ม `isVoided: false` ในทุก query

### [W-006] Credit Note ไม่มี time limit validation (30 วันตามกฎหมาย)
- **หมวด**: 6
- **ไฟล์**: `apps/api/src/modules/receipts/receipts.service.ts:339-365`
- **ปัญหา**: Credit Note ออกได้ทุกเมื่อ ไม่มี validation ว่าต้องออกภายใน 30 วันตามที่กฎหมายกำหนด
- **แนวทางแก้ไข**: เพิ่ม validation: `originalReceiptDate + 30 days >= now`

### [W-007] COGS ไม่มี inventory journal deduction per sale
- **หมวด**: 7
- **ไฟล์**: `apps/api/src/modules/sales/sales.service.ts:229-233`
- **ปัญหา**: Product status เปลี่ยนเป็น SOLD แต่ไม่มี inventory journal entry — COGS คำนวณย้อนหลังจาก sum ไม่ใช่ perpetual method
- **แนวทางแก้ไข**: บันทึก inventory movement record ทุกครั้งที่ขาย (debit COGS / credit Inventory)

### [W-008] ผู้สร้างค่าใช้จ่าย = ผู้อนุมัติ ได้ (Segregation of Duties)
- **หมวด**: 8
- **ไฟล์**: `apps/api/src/modules/accounting/accounting.service.ts:241-249`
- **ปัญหา**: `approveExpense()` ไม่ validate ว่า `approvedById !== expense.createdById` — คนเดียวกันสร้างและอนุมัติได้
- **แนวทางแก้ไข**: เพิ่ม validation: `if (expense.createdById === approvedById) throw new BadRequestException('ผู้อนุมัติต้องไม่ใช่ผู้สร้างรายการ')`

### [W-009] Inter-Company บันทึกฝั่งเดียว (single transaction record)
- **หมวด**: 9
- **ไฟล์**: `apps/api/src/modules/inter-company/inter-company.service.ts:14-37`
- **ปัญหา**: สร้าง InterCompanyTransaction record เดียวต่อ sale แทนที่จะบันทึกทั้ง 2 ฝั่ง (debit/credit) ตาม double-entry
- **แนวทางแก้ไข**: ใช้ paired entries (SHOP debit + FINANCE credit) หรือ document ว่า single record ใช้แยก profit allocation ได้เพียงพอ

### [W-010] Inter-Company ไม่มี CONFIRMED status ก่อน RECONCILED
- **หมวด**: 9
- **ไฟล์**: `apps/api/src/modules/inter-company/inter-company.service.ts:159-172`
- **ปัญหา**: Status flow เป็น PENDING → RECONCILED เท่านั้น ไม่มี CONFIRMED stage — reconcile เป็น manual flag ไม่มี matching logic
- **แนวทางแก้ไข**: เพิ่ม CONFIRMED status + matching verification ก่อนอนุญาต reconcile

### [W-011] AuditLog มี updatedAt field — ขัดหลัก immutability
- **หมวด**: 12
- **ไฟล์**: `apps/api/prisma/schema.prisma:1130`
- **ปัญหา**: AuditLog table มี `updatedAt DateTime @updatedAt` — Prisma auto-update ทุกครั้งที่แก้ไข record ขัดกับหลักว่า audit log ต้อง immutable
- **แนวทางแก้ไข**: ลบ `updatedAt` ออกจาก AuditLog model (เก็บเฉพาะ `createdAt`)

### [W-012] ไม่มีรายงานเปรียบเทียบ MoM / YoY
- **หมวด**: 10
- **ไฟล์**: `apps/api/src/modules/accounting/accounting.service.ts:518-589`
- **ปัญหา**: `getMonthlyPLSummary()` สร้าง P&L รายเดือน แต่ไม่มีการเปรียบเทียบ Month-over-Month หรือ Year-over-Year
- **แนวทางแก้ไข**: เพิ่ม comparison logic ที่ return ทั้งเดือนปัจจุบันและเดือนก่อน พร้อม % change

### [W-013] ไม่มีระบบ Period Closing lock
- **หมวด**: 12
- **ไฟล์**: ไม่พบในระบบ
- **ปัญหา**: ไม่มีกลไกล็อกงวดบัญชี (period closing) เพื่อป้องกันการแก้ไขข้อมูลย้อนหลังหลังปิดงบ
- **แนวทางแก้ไข**: สร้าง `AccountingPeriod` model พร้อมสถานะ OPEN/CLOSED และ validate ทุก transaction ว่าอยู่ในงวดที่เปิดอยู่

### [W-014] Segregation of Duties ไม่ครบ 3 ฝ่าย (สร้าง ≠ อนุมัติ ≠ ตรวจสอบ)
- **หมวด**: 12
- **ไฟล์**: `apps/api/src/modules/audit/audit.controller.ts`
- **ปัญหา**: RBAC มี 4 roles แต่ไม่แยก "ผู้ตรวจสอบ" ออกจาก "ผู้อนุมัติ" อย่างชัดเจน — COSO Framework แนะนำ 3-way segregation
- **แนวทางแก้ไข**: Review role permissions ให้แน่ใจว่า ACCOUNTANT ทำหน้าที่ตรวจสอบ ไม่ใช่อนุมัติ

---

## ข้อเสนอแนะ (Recommendation) — ควรปรับปรุง

### [R-001] Document นโยบายบัญชีสำหรับ interest recognition method
- **หมวด**: 2
- **รายละเอียด**: ระบบใช้ straight-line method สำหรับรับรู้ดอกเบี้ย ซึ่งเหมาะสำหรับ NPAEs แต่ควร document อย่างเป็นทางการว่าเลือกใช้วิธีนี้

### [R-002] เพิ่ม Tax Point validation (จุดความรับผิดทางภาษี)
- **หมวด**: 3
- **รายละเอียด**: ขายสินค้า tax point = วันส่งมอบ, บริการ = วันรับชำระ — ควร validate ว่า receipt date ตรงกับ tax point

### [R-003] เพิ่มรายงาน WHT สรุปรายเดือนสำหรับยื่นภาษี
- **หมวด**: 4
- **รายละเอียด**: แม้ C-003 แก้ field แล้ว ควรมี report ที่ export ได้เป็น format ที่ยื่น ภ.ง.ด.3/53 ได้ทันที

### [R-004] เพิ่ม Bad Debt write-off workflow พร้อม approval chain
- **หมวด**: 5
- **รายละเอียด**: สร้าง service method สำหรับ write-off พร้อม: หลักฐานการติดตาม, อนุมัติจาก OWNER, journal entry อัตโนมัติ

### [R-005] เพิ่ม hash verification สำหรับตรวจสอบ tampering ของใบเสร็จ
- **หมวด**: 6
- **รายละเอียด**: SHA-256 hash สร้างแล้วแต่ไม่มีการ verify เมื่อดึงข้อมูล — เพิ่ม verification endpoint

### [R-006] เพิ่ม receipt types: DEPOSIT_REFUND, EXCHANGE
- **หมวด**: 6
- **รายละเอียด**: ปัจจุบันรองรับ PAYMENT, DOWN_PAYMENT, EARLY_PAYOFF, CREDIT_NOTE — ขาด refund และ exchange types

### [R-007] Repossessed goods ควรปรับ costPrice ตาม appraised value
- **หมวด**: 7
- **ไฟล์**: `apps/api/src/modules/repossessions/repossessions.service.ts:279-306`
- **รายละเอียด**: สินค้ายึดคืนเข้าสต็อกเป็น REFURBISHED แต่ไม่ปรับ costPrice → ต้นทุนเดิมไม่สะท้อนมูลค่าจริง

### [R-008] Recurring expenses ควร auto-generate ตามเกณฑ์คงค้าง
- **หมวด**: 8
- **รายละเอียด**: Schema มี `isRecurring` + `recurringDay` แต่ไม่มี service ที่ auto-generate — ควรสร้าง cron job

### [R-009] Document Inter-Company transfer pricing policy (arm's length)
- **หมวด**: 9
- **รายละเอียด**: Commission rate 10% default ไม่มี arm's length study — ควร document transfer pricing policy ตาม TAS 24

### [R-010] เพิ่ม late fee sharing configuration ระหว่าง SHOP/FINANCE
- **หมวด**: 9
- **รายละเอียด**: ปัจจุบัน FINANCE รับค่าปรับ 100% — ควรทำเป็น configurable

### [R-011] P&L ควรแสดงรายได้อื่น (ดอกเบี้ย, ค่าปรับ) แยกจากรายได้หลัก
- **หมวด**: 10
- **รายละเอียด**: ปัจจุบัน P&L รวมรายได้ทุกประเภทเป็น totalRevenue — ควรแยก operating revenue vs other income ให้ชัดเจน (มีอยู่บางส่วนแล้วแต่ควรปรับโครงสร้าง)

### [R-012] Payment idempotency ใช้ string search ใน notes field
- **หมวด**: 11
- **ไฟล์**: `apps/api/src/modules/payments/payments.service.ts:66`
- **รายละเอียด**: `transactionRef` check ใช้ `notes.contains` ซึ่งอาจ false positive — ควรใช้ dedicated unique field แทน

### [R-013] Audit interceptor entity extraction อาจผิดพลาดกับ nested URLs
- **หมวด**: 12
- **ไฟล์**: `apps/api/src/modules/audit/audit.interceptor.ts:83-111`
- **รายละเอียด**: URL parsing อาจได้ entity ผิดสำหรับ nested routes เช่น `/contracts/{id}/payments/{paymentId}` → extracts "payments" แทน "contracts"

### [R-014] Expense model: ควรเพิ่ม field สำหรับ payment method
- **หมวด**: 8
- **รายละเอียด**: ค่าใช้จ่ายไม่มี field ระบุวิธีจ่ายเงิน (เงินสด, โอน, เช็ค) — จำเป็นสำหรับ audit trail

### [R-015] เพิ่ม Quarterly report aggregation
- **หมวด**: 10
- **รายละเอียด**: ปัจจุบันมี daily/monthly — เพิ่ม quarterly aggregation สำหรับยื่นภาษีรายไตรมาส

---

## สิ่งที่ทำได้ดี (Good Practices)

### Revenue Recognition (หมวด 2) — ✅ ดีเยี่ยม
- **Cash sales**: รับรู้ทันทีเมื่อส่งมอบ — ถูกต้องตาม TFRS 15
- **Down payment**: รับรู้ ณ วันขาย — ถูกต้อง
- **Installment payments**: รับรู้เมื่อได้รับชำระ (paidDate) ไม่ใช่ dueDate — ถูกต้อง
- **External finance**: รับรู้เมื่อ FinanceReceivable status = RECEIVED — ถูกต้อง
- **Late fees**: รับรู้เฉพาะที่ไม่ waive — ถูกต้อง
- **ไม่มี double counting** ระหว่าง modules — ตรวจสอบแล้ว

### Payment Allocation (หมวด 11) — ✅ ดีเยี่ยม
- **FIFO allocation**: จ่ายงวดเก่าสุดก่อน (`orderBy: installmentNo asc`) — ถูกต้อง
- **Late fee**: คำนวณ `daysOverdue × feePerDay` พร้อม cap 1,500 บาท — สมเหตุสมผล
- **Overpayment**: บันทึกเป็น creditBalance ใน Contract — ถูกต้อง
- **Idempotent payment**: ป้องกัน duplicate ด้วย transactionRef — ดี
- **Early payoff 50% discount**: คำนวณจากดอกเบี้ยคงเหลือ — ถูกต้อง
- **Satang precision**: `roundBaht()` ใช้ `Math.round(value * 100) / 100` ทั่วทั้งระบบ — ดี
- **Last payment adjustment**: งวดสุดท้ายปรับยอดให้ตรง financedAmount — ป้องกัน rounding error

### Expense Workflow (หมวด 8) — ✅ ดี
- Status flow: DRAFT → PENDING_APPROVAL → APPROVED → PAID — ครบถ้วน
- APPROVED/PAID expenses ล็อกไม่ให้แก้ไข — ถูกต้อง
- Account code mapping (5101-5999) ครบและถูกต้อง — ดี
- VAT calculation ใช้ 7% จาก system config — configurable และถูกต้อง

### Audit Trail (หมวด 12) — ✅ ดี
- Payment/Receipt/Contract events ถูก log ครบ — ดี
- Audit log เก็บ: userId, action, entity, entityId, oldValue, newValue, ipAddress, userAgent — ครบถ้วน
- Sensitive data redacted (password, token, secret, accessToken, refreshToken) — ดี
- Security middleware: HSTS, CSP, XSS protection, X-Frame-Options — ดี
- RBAC enforced ทุก controller — ดี

### Inter-Company (หมวด 9) — ✅ ดี
- Profit allocation ถูกต้อง: Shop = downPayment + principal + commission - cost, Finance = interest - commission
- Price snapshot ณ วันทำรายการ (immutable) — ถูกต้อง
- VAT ไม่นับซ้ำระหว่าง entities — ดี
- Entity Profit Report แยก SHOP/FINANCE — ใช้งานได้

### Receipt Integrity (หมวด 6) — ✅ ดี
- Sequential numbering RC-YYYY-MM-NNNNN พร้อม concurrency lock — ดีมาก
- SHA-256 file hash ป้องกัน tampering — ดี
- Issuer tracking (issuedById) — ดี
- Credit Note auto-generate เมื่อ void — ดี
- Receipt types ครอบคลุม: PAYMENT, DOWN_PAYMENT, EARLY_PAYOFF, CREDIT_NOTE

### Database Design — ✅ ดี
- Money fields ใช้ `Decimal(12,2)` ทั้งหมด — ไม่มี Float
- Soft delete ทุก model (ยกเว้น AuditLog ที่ต้อง immutable) — ถูกต้อง
- UUID สำหรับ ID ทุก model — ดี
- Timestamps (createdAt, updatedAt, deletedAt) ครบทุก model — ดี

---

## Action Items

| ลำดับ | ประเด็น | ความเร่งด่วน | ผู้รับผิดชอบ | หมายเหตุ |
|:-----:|---------|:----------:|:-----------:|---------|
| 1 | **C-002** VAT รวมดอกเบี้ย — แก้สูตร installment.util.ts | **สูงมาก** | Backend Dev | ผิดกฎหมาย — แก้ก่อนใช้งานจริง |
| 2 | **C-006** Bundle cost ไม่รวมใน COGS | **สูง** | Backend Dev | กำไรขั้นต้น overstate |
| 3 | **C-005** ใบเสร็จขาดข้อมูลตามกฎหมาย | **สูง** | Full-stack | ใช้เป็นใบกำกับภาษีไม่ได้ |
| 4 | **C-007** Expense void ไม่มี trail | **สูง** | Backend Dev | เพิ่ม 3 fields + validation |
| 5 | **W-008** Creator = Approver ได้ | **สูง** | Backend Dev | เพิ่ม 1 line validation |
| 6 | **C-001** ผังบัญชีไม่ครบ 5 หมวด | **สูง** | Backend Dev + Accountant | Foundation สำหรับ C-008 |
| 7 | **C-004** ไม่มีระบบตั้งสำรองหนี้สงสัยจะสูญ | **สูง** | Backend Dev + Accountant | ลูกหนี้ overstate |
| 8 | **C-003** WHT ไม่สมบูรณ์ | **สูง** | Backend Dev | ต้องยื่น ภ.ง.ด.3/53 |
| 9 | **C-008** ขาดงบดุล + งบกระแสเงินสด | **กลาง** | Backend Dev + Accountant | ต้องมีผังบัญชีก่อน (C-001) |
| 10 | **W-011** AuditLog updatedAt | **กลาง** | Backend Dev | ลบ 1 field |
| 11 | **W-013** Period Closing lock | **กลาง** | Backend Dev | ป้องกันแก้ไขย้อนหลัง |
| 12 | **W-009** Inter-Company single entry | **กลาง** | Backend Dev | หรือ document ว่ายอมรับได้ |
| 13 | **W-005** Voided receipt still in queries | **กลาง** | Backend Dev | เพิ่ม filter |
| 14 | **W-012** ไม่มี MoM/YoY comparison | **ต่ำ** | Backend Dev | Nice to have |
| 15 | **R-001 - R-015** ข้อเสนอแนะทั้งหมด | **ต่ำ** | ทีม | ปรับปรุงตามลำดับ |

---

## หมายเหตุ

1. **ขอบเขตการตรวจสอบ**: ตรวจจาก source code เท่านั้น ไม่ได้ตรวจ runtime behavior หรือ production data
2. **มาตรฐานอ้างอิง**: TFRS 15, TAS 2, TAS 18, TAS 24, TFRS 9, TFRS 10, TFRS for NPAEs, ประมวลรัษฎากร, พ.ร.บ.การบัญชี พ.ศ. 2543, COSO Framework
3. **Positive note**: ระบบมีพื้นฐานที่ดี โดยเฉพาะ Revenue Recognition, Payment Allocation, และ Audit Trail — ส่วนใหญ่ที่ต้องแก้ไขเป็นเรื่อง completeness ของข้อมูลบัญชี ไม่ใช่ logic ผิด
4. **Priority recommendation**: แก้ C-002 (VAT) ก่อนเป็นอันดับแรก เพราะมีผลกระทบทางกฎหมายโดยตรงกับลูกค้าทุกราย

---

*รายงานฉบับนี้สร้างโดย AI Auditor — ควรให้ผู้สอบบัญชีรับอนุญาต (CPA) ตรวจทานอีกครั้งก่อนดำเนินการ*
