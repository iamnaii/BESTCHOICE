# Prompt: ตรวจสอบระบบบัญชี BESTCHOICE ตามหลักบัญชีไทย

## บทบาทของคุณ

คุณเป็น **ผู้สอบบัญชีรับอนุญาต (CPA)** ที่เชี่ยวชาญมาตรฐานการบัญชีไทยและกฎหมายภาษีอากร มีหน้าที่ตรวจสอบว่าระบบซอฟต์แวร์บัญชีของ BESTCHOICE (ระบบผ่อนชำระสำหรับร้านมือถือ) ปฏิบัติถูกต้องตามหลักบัญชีไทยหรือไม่

## ข้อมูลพื้นฐานของระบบ

BESTCHOICE เป็นระบบ **Hire-Purchase / ผ่อนชำระ** สำหรับร้านขายมือถือในประเทศไทย ประกอบด้วย:
- ขายเงินสด (CASH), ขายผ่อน (INSTALLMENT), ขายผ่านไฟแนนซ์ภายนอก (EXTERNAL_FINANCE)
- สัญญาผ่อนชำระ 6-12 เดือน ดอกเบี้ยแบบ flat rate
- บัญชีระหว่างกัน 2 นิติบุคคล: BESTCHOICE SHOP (ขายสินค้า) และ BESTCHOICE FINANCE (จัดไฟแนนซ์)
- ระบบค่าใช้จ่ายพร้อม workflow อนุมัติ
- รายงาน P&L, Aging Report, Entity Profit

### Tech Stack
- Backend: NestJS + Prisma + PostgreSQL
- Frontend: React + TypeScript
- เงิน: ใช้ Decimal(12,2) ทุก field

---

## หมวดการตรวจสอบ

### หมวดที่ 1: ผังบัญชี (Chart of Accounts)

**มาตรฐานอ้างอิง:** กรมพัฒนาธุรกิจการค้า, มาตรฐานผังบัญชี สำหรับ SMEs

**ไฟล์ที่ต้องตรวจ:**
- `apps/api/src/modules/accounting/accounting.service.ts` — CATEGORY_ACCOUNT_MAP, CATEGORY_CODE_MAP

**Checklist:**
- [ ] ผังบัญชีครบ 5 หมวด: สินทรัพย์ (1xxx), หนี้สิน (2xxx), ส่วนของเจ้าของ (3xxx), รายได้ (4xxx), ค่าใช้จ่าย (5xxx)
- [ ] รหัสบัญชีค่าใช้จ่าย (5xxx) จัดกลุ่มถูกต้อง: ต้นทุนขาย, ค่าใช้จ่ายในการขาย, ค่าใช้จ่ายบริหาร, ค่าใช้จ่ายอื่น
- [ ] มีบัญชีสำหรับ: ลูกหนี้การค้า, สินค้าคงเหลือ, ลูกหนี้เช่าซื้อ, รายได้ดอกเบี้ย, รายได้ค่าปรับ, ภาษีซื้อ, ภาษีขาย
- [ ] รหัสบัญชีไม่ซ้ำซ้อนและเรียงลำดับถูกต้อง
- [ ] มีบัญชีสำหรับ: ค่าเผื่อหนี้สงสัยจะสูญ, หนี้สูญ, ส่วนลดรับ/จ่าย
- [ ] บัญชีรายได้แยกประเภท: ขายเงินสด, รายได้ดอกเบี้ยเช่าซื้อ, รายได้ค่าปรับล่าช้า, รายได้ค่านายหน้า

---

### หมวดที่ 2: การรับรู้รายได้ (Revenue Recognition)

**มาตรฐานอ้างอิง:** TFRS 15 (รายได้จากสัญญากับลูกค้า), TAS 18 (รายได้)

**ไฟล์ที่ต้องตรวจ:**
- `apps/api/src/modules/accounting/accounting.service.ts` — getProfitLossReport()
- `apps/api/src/modules/reports/reports.service.ts` — getRevenuePLReport()
- `apps/api/src/modules/sales/sales.service.ts` — createCashSale(), createInstallmentSale()
- `apps/api/src/modules/contracts/contracts.service.ts` — create()

**Checklist:**
- [ ] **ขายเงินสด**: รับรู้รายได้ทั้งจำนวนเมื่อส่งมอบสินค้า (ถูกต้องตาม TFRS 15)
- [ ] **ขายผ่อน (เงินดาวน์)**: รับรู้เงินดาวน์เป็นรายได้ ณ วันขาย
- [ ] **ขายผ่อน (งวดผ่อน)**: รับรู้รายได้เมื่อได้รับชำระเงินแต่ละงวด — ไม่ใช่รับรู้ทั้งจำนวนล่วงหน้า
- [ ] **รายได้ดอกเบี้ย**: แยกจากรายได้ขายสินค้า — ตรวจว่ามีการแยก principal กับ interest ในแต่ละงวด
- [ ] **รายได้ค่าปรับล่าช้า**: รับรู้เมื่อมีสิทธิเรียกเก็บ (วันครบกำหนดผ่านแล้ว)
- [ ] **รายได้ค่า commission**: รับรู้เมื่อธุรกรรมเสร็จสมบูรณ์
- [ ] **ไฟแนนซ์ภายนอก**: รับรู้รายได้เมื่อได้รับเงินจากบริษัทไฟแนนซ์ (ไม่ใช่ ณ วันขาย)
- [ ] P&L Report คำนวณ: รายได้รวม = ขายเงินสด + เงินดาวน์ + งวดผ่อนที่ได้รับ + ดอกเบี้ย + ค่าปรับ + เงินจากไฟแนนซ์
- [ ] ไม่มีการรับรู้รายได้ซ้ำซ้อน (double counting) ระหว่าง modules

---

### หมวดที่ 3: ภาษีมูลค่าเพิ่ม (VAT)

**มาตรฐานอ้างอิง:** ประมวลรัษฎากร มาตรา 77-90, พ.ร.บ.ภาษีมูลค่าเพิ่ม

**ไฟล์ที่ต้องตรวจ:**
- `apps/api/src/modules/accounting/accounting.service.ts` — VAT calculation
- `apps/api/src/modules/interest-config/interest-config.service.ts` — vatPct
- `apps/api/src/modules/inter-company/inter-company.service.ts` — vatAmount, vatPct
- `apps/api/prisma/schema.prisma` — Expense model (vatAmount field)

**Checklist:**
- [ ] VAT rate = 7% (ตรงกับอัตราปัจจุบัน)
- [ ] **ภาษีขาย (Output VAT)**: คำนวณจากราคาขายสินค้า (ไม่ใช่จากดอกเบี้ย — ดอกเบี้ยเช่าซื้อได้รับยกเว้น VAT ตามมาตรา 81(1)(ช))
- [ ] **ภาษีซื้อ (Input VAT)**: บันทึกจากใบกำกับภาษีของค่าใช้จ่าย
- [ ] VAT คำนวณบน base amount ที่ถูกต้อง: `vatAmount = baseAmount × 7/107` (กรณีราคารวม VAT) หรือ `baseAmount × 0.07` (กรณีราคาไม่รวม VAT)
- [ ] มีการแยก: ราคาก่อน VAT, จำนวน VAT, ราคารวม VAT ในทุก transaction
- [ ] Expense model มี field vatAmount — ตรวจว่าคำนวณถูกทุกกรณี
- [ ] Inter-company transactions คำนวณ VAT ถูกต้อง
- [ ] ระบบรองรับกรณียกเว้น VAT (เช่น ดอกเบี้ยเช่าซื้อ)
- [ ] **จุดความรับผิดทางภาษี (Tax Point)**: ขายสินค้า = วันส่งมอบ, บริการ = วันรับชำระ

---

### หมวดที่ 4: ภาษีหัก ณ ที่จ่าย (Withholding Tax)

**มาตรฐานอ้างอิง:** ประมวลรัษฎากร มาตรา 3 เตรส, 50, 69 ทวิ

**ไฟล์ที่ต้องตรวจ:**
- `apps/api/src/modules/accounting/accounting.service.ts` — withholdingTax handling
- `apps/api/prisma/schema.prisma` — Expense.withholdingTax field
- `apps/api/src/modules/accounting/dto/expense.dto.ts`

**Checklist:**
- [ ] รองรับอัตราภาษีหัก ณ ที่จ่ายหลายอัตรา: 1%, 2%, 3%, 5% ตามประเภทเงินได้
- [ ] คำนวณ: `withholdingTax = paymentAmount × rate` (ก่อน VAT)
- [ ] จ่ายจริง = จำนวนเงิน - ภาษีหัก ณ ที่จ่าย
- [ ] มี field เพียงพอสำหรับ: อัตราภาษี, จำนวนภาษีที่หัก, ประเภทเงินได้
- [ ] บันทึก tax invoice number ของผู้รับเงิน
- [ ] มีรายงานสรุปภาษีหัก ณ ที่จ่ายรายเดือน (สำหรับยื่น ภ.ง.ด.3, ภ.ง.ด.53)
- [ ] กรณีจ่ายค่านายหน้า (commission) ให้บุคคลธรรมดา หัก 5% (มาตรา 40(2))
- [ ] กรณีจ่ายค่าเช่า หัก 5% (มาตรา 40(5))
- [ ] กรณีจ่ายค่าบริการ/ค่าจ้าง หัก 3% (มาตรา 40(8))

---

### หมวดที่ 5: ลูกหนี้เช่าซื้อและการตั้งสำรองหนี้สงสัยจะสูญ

**มาตรฐานอ้างอิง:** TAS 32 (เครื่องมือทางการเงิน: การนำเสนอ), TFRS 9 (เครื่องมือทางการเงิน), มาตรฐานบัญชี PAEs/NPAEs

**ไฟล์ที่ต้องตรวจ:**
- `apps/api/src/modules/contracts/contracts.service.ts` — contract lifecycle
- `apps/api/src/modules/contracts/contract-payment.service.ts` — early payoff
- `apps/api/src/modules/overdue/overdue.service.ts` — overdue tracking
- `apps/api/src/modules/reports/reports.service.ts` — getAgingReport()
- `apps/api/prisma/schema.prisma` — Contract model, Payment model

**Checklist:**
- [ ] **Aging Report** แบ่งกลุ่มอายุหนี้ถูกต้อง: ยังไม่ถึงกำหนด, 1-30 วัน, 31-60 วัน, 61-90 วัน, มากกว่า 90 วัน
- [ ] มีระบบตั้งค่าเผื่อหนี้สงสัยจะสูญ (Allowance for Doubtful Accounts) ตามอายุหนี้
- [ ] อัตราการตั้งสำรอง:
  - 1-30 วัน: X%
  - 31-60 วัน: X%
  - 61-90 วัน: X%
  - >90 วัน: X%
  - >360 วัน: ตัดเป็นหนี้สูญ
- [ ] สถานะสัญญา DEFAULT → มีกระบวนการตัดหนี้สูญ (Bad Debt Write-off)
- [ ] การตัดหนี้สูญต้องมี: หลักฐานการติดตาม, อนุมัติจากผู้มีอำนาจ
- [ ] ลูกหนี้เช่าซื้อแสดงเป็น: ยอดรวมลูกหนี้ - ดอกเบี้ยรอรับรู้ = มูลค่าสุทธิ
- [ ] Early payoff: ส่วนลดดอกเบี้ย 50% → ตรวจว่าบันทึกเป็น "ส่วนลดจ่าย" หรือ "รายได้ดอกเบี้ยลดลง" อย่างถูกต้อง
- [ ] Credit balance (เงินเกิน) บันทึกเป็นเจ้าหนี้ (หนี้สินหมุนเวียน) ไม่ใช่หักจากลูกหนี้

---

### หมวดที่ 6: ใบเสร็จรับเงิน / ใบกำกับภาษี

**มาตรฐานอ้างอิง:** ประมวลรัษฎากร มาตรา 86/4 (ใบกำกับภาษี), พ.ร.บ.การบัญชี พ.ศ. 2543

**ไฟล์ที่ต้องตรวจ:**
- `apps/api/src/modules/receipts/receipts.service.ts` — generateReceipt()
- `apps/api/prisma/schema.prisma` — Receipt model

**Checklist:**
- [ ] เลขที่ใบเสร็จ (RC-YYYY-MM-NNNNN) เรียงลำดับต่อเนื่อง ไม่ข้ามเลข
- [ ] ข้อมูลครบตามกฎหมาย:
  - ชื่อ/ที่อยู่/เลขประจำตัวผู้เสียภาษีของผู้ออก
  - ชื่อ/ที่อยู่ของผู้รับ
  - วันที่ออก
  - รายละเอียดสินค้า/บริการ
  - จำนวนเงิน (แยกก่อน VAT, VAT, รวม VAT ถ้าเป็นใบกำกับภาษี)
- [ ] การยกเลิกใบเสร็จ (Void): มีเหตุผล, มีผู้อนุมัติ, ออก Credit Note อ้างอิง
- [ ] ใบเสร็จที่ยกเลิกยังคงอยู่ในระบบ (ไม่ลบ) — ตรวจสอบ soft delete
- [ ] ประเภทใบเสร็จ (PAYMENT, DOWN_PAYMENT, EARLY_PAYOFF, CREDIT_NOTE) ครอบคลุมทุกกรณี
- [ ] File hash (SHA-256) ป้องกันการแก้ไขหลังออก → ดีสำหรับ integrity
- [ ] เก็บข้อมูลผู้ออก (issuedById) สำหรับ audit trail

---

### หมวดที่ 7: ต้นทุนขาย (Cost of Goods Sold)

**มาตรฐานอ้างอิง:** TAS 2 (สินค้าคงเหลือ)

**ไฟล์ที่ต้องตรวจ:**
- `apps/api/src/modules/sales/sales.service.ts` — costPrice tracking
- `apps/api/src/modules/stock/` — inventory management
- `apps/api/src/modules/accounting/accounting.service.ts` — COGS calculation in P&L
- `apps/api/prisma/schema.prisma` — Product model, Sale model

**Checklist:**
- [ ] ต้นทุนสินค้า (costPrice) บันทึกถูกต้องเมื่อรับสินค้าเข้า
- [ ] วิธีคำนวณต้นทุน: FIFO, Weighted Average, หรือ Specific Identification — ระบุให้ชัดเจน
- [ ] เมื่อขายสินค้า: ตัดต้นทุนออกจากสินค้าคงเหลือและบันทึกเป็นต้นทุนขาย
- [ ] P&L: ต้นทุนขาย = sum(costPrice) ของสินค้าที่ขายในงวด
- [ ] กำไรขั้นต้น = รายได้ขาย - ต้นทุนขาย
- [ ] สินค้าที่ยึดคืน (Repossession): มีการบันทึกกลับเข้าสต็อกด้วยมูลค่าที่เหมาะสม
- [ ] Bundle products: ต้นทุนของสินค้าแถมบันทึกถูกต้อง (รวมในต้นทุนขาย หรือค่าส่งเสริมการขาย)

---

### หมวดที่ 8: ค่าใช้จ่ายและ Workflow อนุมัติ

**มาตรฐานอ้างอิง:** พ.ร.บ.การบัญชี พ.ศ. 2543, หลักการควบคุมภายใน

**ไฟล์ที่ต้องตรวจ:**
- `apps/api/src/modules/accounting/accounting.service.ts` — expense CRUD + approval
- `apps/api/src/modules/accounting/accounting.controller.ts` — role-based access
- `apps/api/src/modules/accounting/dto/expense.dto.ts`
- `apps/api/prisma/schema.prisma` — Expense model

**Checklist:**
- [ ] Workflow: DRAFT → PENDING_APPROVAL → APPROVED → PAID (มีการแบ่งแยกหน้าที่)
- [ ] ผู้สร้าง ≠ ผู้อนุมัติ (Segregation of Duties)
- [ ] ค่าใช้จ่ายที่ APPROVED/PAID แล้วแก้ไขไม่ได้
- [ ] การ Void ต้องมีเหตุผลและอนุมัติโดย OWNER เท่านั้น
- [ ] Account code mapping ถูกต้อง:
  - 5101: ต้นทุนสินค้า
  - 5102: ต้นทุนอะไหล่ซ่อม
  - 5201-5204: ค่าใช้จ่ายในการขาย
  - 5301-5311: ค่าใช้จ่ายบริหาร
  - 5901-5999: ค่าใช้จ่ายอื่น
- [ ] ค่าใช้จ่ายที่เกิดขึ้นประจำ (isRecurring) บันทึกตามเกณฑ์คงค้าง
- [ ] มี tax invoice reference สำหรับค่าใช้จ่ายที่มี VAT
- [ ] ค่าใช้จ่ายแต่ละรายการมี: วันที่, ผู้รับเงิน, คำอธิบาย, จำนวนเงิน, หมวดบัญชี

---

### หมวดที่ 9: บัญชีระหว่างกัน (Inter-Company Accounting)

**มาตรฐานอ้างอิง:** TAS 24 (การเปิดเผยข้อมูลเกี่ยวกับบุคคลหรือกิจการที่เกี่ยวข้องกัน), TFRS 10 (งบการเงินรวม)

**ไฟล์ที่ต้องตรวจ:**
- `apps/api/src/modules/inter-company/inter-company.service.ts` — createFromSale(), getProfitSummary()
- `apps/api/src/modules/inter-company/inter-company.controller.ts`
- `apps/api/src/modules/reports/reports.service.ts` — getEntityProfitReport()
- `apps/api/prisma/schema.prisma` — InterCompanyTransaction model

**Checklist:**
- [ ] ทุก transaction ระหว่าง SHOP ↔ FINANCE มีบันทึกครบทั้ง 2 ฝั่ง (debit/credit)
- [ ] Reconciliation: มีกระบวนการกระทบยอดระหว่างกัน (reconciledAt)
- [ ] Profit allocation ถูกต้อง:
  - Shop Profit = เงินดาวน์ + เงินต้น + commission - ต้นทุน
  - Finance Profit = ดอกเบี้ยรวม - commission
- [ ] Snapshot ราคา ณ วันทำรายการ (ไม่เปลี่ยนตามราคาปัจจุบัน)
- [ ] สถานะ: PENDING → CONFIRMED → RECONCILED — มี audit trail
- [ ] VAT ระหว่างกัน: คำนวณถูกต้องและไม่นับซ้ำ
- [ ] รายงาน Entity Profit แยก SHOP/FINANCE ถูกต้อง — ตรวจยอดรวมว่าตรงกับ P&L รวม
- [ ] ค่า commission ระหว่างกันเป็นราคาตลาด (arm's length principle)
- [ ] Late fee sharing: ส่วนแบ่งค่าปรับบันทึกถูกต้องทั้ง 2 ฝั่ง

---

### หมวดที่ 10: รายงานทางการเงิน (Financial Statements)

**มาตรฐานอ้างอิง:** พ.ร.บ.การบัญชี พ.ศ. 2543, TFRS for NPAEs (กิจการที่ไม่มีส่วนได้เสียสาธารณะ)

**ไฟล์ที่ต้องตรวจ:**
- `apps/api/src/modules/accounting/accounting.service.ts` — getProfitLossReport(), getMonthlyPLSummary()
- `apps/api/src/modules/reports/reports.service.ts` — all report methods
- `apps/web/src/pages/ReportsPage.tsx`

**Checklist:**
- [ ] **งบกำไรขาดทุน (P&L)** มีโครงสร้าง:
  - รายได้จากการขาย (ขายเงินสด + ขายผ่อน)
  - (-) ต้นทุนขาย
  - = กำไรขั้นต้น
  - (-) ค่าใช้จ่ายในการขาย
  - (-) ค่าใช้จ่ายบริหาร
  - = กำไรจากการดำเนินงาน
  - (+) รายได้อื่น (ดอกเบี้ย, ค่าปรับ)
  - (-) ค่าใช้จ่ายอื่น
  - = กำไรสุทธิก่อนภาษี
  - (-) ภาษีเงินได้
  - = กำไรสุทธิ
- [ ] Aging Report ข้อมูลตรงกับ Payment records จริง
- [ ] รายงาน P&L ตรงกับข้อมูลจริงใน database (ไม่มีตัวเลขฮาร์ดโค้ด)
- [ ] รองรับกรอบเวลา: รายวัน, รายเดือน, รายไตรมาส, รายปี
- [ ] มีรายงานเปรียบเทียบ (เดือนต่อเดือน, ปีต่อปี)
- [ ] ระบบมี/ขาด งบดุล (Balance Sheet), งบกระแสเงินสด (Cash Flow Statement)

---

### หมวดที่ 11: การชำระเงินและการจัดสรร (Payment Allocation)

**มาตรฐานอ้างอิง:** หลักปฏิบัติทางบัญชีสำหรับสัญญาเช่าซื้อ

**ไฟล์ที่ต้องตรวจ:**
- `apps/api/src/modules/payments/payments.service.ts` — recordPayment(), autoAllocatePayment()
- `apps/api/src/utils/installment.util.ts` — calculateInstallment(), generatePaymentSchedule()
- `apps/api/src/modules/contracts/contract-payment.service.ts` — getEarlyPayoffQuote()

**Checklist:**
- [ ] การจัดสรรเงินชำระ: ชำระงวดเก่าสุดก่อน (FIFO) → ถูกต้อง
- [ ] แยกเงินต้น/ดอกเบี้ยในแต่ละงวด: monthlyPrincipal vs monthlyInterest
- [ ] ค่าปรับล่าช้า (late fee): คำนวณตาม วันล่าช้า × อัตราต่อวัน, มี cap → ตรวจว่าไม่เกินที่กฎหมายกำหนด
- [ ] Overpayment → บันทึกเป็น creditBalance ในสัญญา → ตรวจว่าใช้หักงวดถัดไปถูกต้อง
- [ ] Idempotent payment (transactionRef) → ป้องกันรายการซ้ำ
- [ ] Early payoff discount: ส่วนลด 50% ของดอกเบี้ยคงเหลือ → บันทึกในบัญชีถูกต้อง
- [ ] Payment schedule: สร้างตารางผ่อนที่ยอดรวมตรงกับ financedAmount
- [ ] Rounding: ใช้ satang precision (×100) → ตรวจว่ายอดรวมทุกงวด = financedAmount พอดี
- [ ] Partial payment: บันทึกสถานะ PARTIALLY_PAID ถูกต้อง

---

### หมวดที่ 12: Audit Trail และการควบคุมภายใน

**มาตรฐานอ้างอิง:** พ.ร.บ.การบัญชี พ.ศ. 2543 มาตรา 12, หลักการควบคุมภายใน COSO Framework

**ไฟล์ที่ต้องตรวจ:**
- `apps/api/src/modules/audit/audit.service.ts` — logPaymentEvent(), logReceiptEvent()
- `apps/api/src/modules/audit/audit.interceptor.ts`
- `apps/api/src/modules/audit/security.middleware.ts`
- `apps/api/src/modules/audit/audit.controller.ts`
- `apps/api/prisma/schema.prisma` — AuditLog model

**Checklist:**
- [ ] ทุก transaction ทางการเงินมี audit log: สร้าง, แก้ไข, อนุมัติ, ยกเลิก
- [ ] Audit log เก็บ: userId, action, entity, old/new values, timestamp, IP address
- [ ] Audit log เป็น **immutable** — ไม่สามารถแก้ไขหรือลบได้
- [ ] ข้อมูลที่ sensitive (password, token) ถูก redact ออกจาก log
- [ ] Financial audit trail: ครอบคลุม payment, receipt, contract status changes
- [ ] Role-based access control:
  - OWNER: เข้าถึงทุกอย่าง
  - ACCOUNTANT: เข้าถึงข้อมูลการเงิน, ไม่แก้ไขสัญญา
  - BRANCH_MANAGER: เฉพาะสาขาตัวเอง
  - SALES: เฉพาะ POS และลูกค้า
- [ ] Segregation of Duties: ผู้สร้างรายการ ≠ ผู้อนุมัติ ≠ ผู้ตรวจสอบ
- [ ] Soft delete ทุก model — ไม่มีการลบข้อมูลถาวร (ตรงตามกฎหมาย: เก็บ 5 ปี)
- [ ] ระบบ lock ป้องกันการแก้ไขข้อมูลย้อนหลัง (period closing)

---

## รูปแบบรายงานผลตรวจสอบ

ให้รายงานผลตรวจสอบในรูปแบบนี้:

```markdown
# รายงานผลตรวจสอบระบบบัญชี BESTCHOICE
วันที่ตรวจสอบ: [วันที่]

## สรุปผลรวม
| หมวด | สถานะ | ประเด็นวิกฤต | ประเด็นเตือน | ข้อเสนอแนะ |
|------|--------|-------------|-------------|------------|
| 1. ผังบัญชี | PASS/FAIL/PARTIAL | 0 | 0 | 0 |
| 2. รับรู้รายได้ | ... | ... | ... | ... |
| ... | ... | ... | ... | ... |

## ประเด็นวิกฤต (Critical) — ต้องแก้ไขทันที
### [C-001] ชื่อประเด็น
- **หมวด**: X
- **ไฟล์**: path/to/file.ts:line
- **ปัญหา**: อธิบายปัญหา
- **มาตรฐานที่ขัด**: TAS/TFRS/กฎหมายที่เกี่ยวข้อง
- **ความเสี่ยง**: ผลกระทบทางกฎหมาย/การเงิน
- **แนวทางแก้ไข**: วิธีแก้ที่เสนอ

## ประเด็นเตือน (Warning) — ควรแก้ไข
### [W-001] ชื่อประเด็น
- (รูปแบบเดียวกัน)

## ข้อเสนอแนะ (Recommendation) — ควรปรับปรุง
### [R-001] ชื่อประเด็น
- (รูปแบบเดียวกัน)

## สิ่งที่ทำได้ดี (Good Practices)
- รายการสิ่งที่ระบบทำถูกต้องแล้ว

## Action Items
| ลำดับ | ประเด็น | ความเร่งด่วน | ผู้รับผิดชอบ | กำหนดเสร็จ |
|-------|---------|-------------|-------------|-----------|
| 1 | ... | สูง/กลาง/ต่ำ | ... | ... |
```

---

## ขอบเขตที่ไม่ต้องตรวจ

- ~~ดอกเบี้ย flat rate กับ พ.ร.บ.ผ่อนชำระ~~ (ไม่ต้องตรวจ)
- ไม่ตรวจ performance / scalability
- ไม่ตรวจ UI/UX design
- ไม่ตรวจ security vulnerabilities (มี audit แยกต่างหาก)

---

## วิธีใช้ Prompt นี้

1. **Copy Prompt ทั้งหมด** ข้างบนไปใช้ใน Claude Code conversation ใหม่
2. Claude จะ **อ่านไฟล์ทุกไฟล์** ที่ระบุในแต่ละหมวด
3. ตรวจสอบตาม **Checklist** ทีละข้อ
4. สร้าง **รายงานผลตรวจสอบ** ตามรูปแบบที่กำหนด
5. Review ผลและดำเนินการตาม Action Items

### คำสั่งเริ่มต้น:
```
ตรวจสอบระบบบัญชี BESTCHOICE ตามหลักบัญชีไทย โดยใช้ Prompt ใน docs/prompts/ACCOUNTING-AUDIT-PROMPT.md — อ่านทุกไฟล์ที่ระบุ, ตรวจตาม Checklist ทุกข้อ, และสร้างรายงานผลตรวจสอบ
```
