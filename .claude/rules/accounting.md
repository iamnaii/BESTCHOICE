# Accounting Rules (TFRS for NPAEs)

## มาตรฐาน
- ใช้ **TFRS for NPAEs** (มาตรฐานรายงานทางการเงินสำหรับกิจการที่ไม่มีส่วนได้เสียสาธารณะ)
- ระบบบันทึกบัญชีแบบ **double-entry** ผ่าน `JournalAutoService`

## Revenue Recognition
- **Cash basis** สำหรับรายได้ — รับรู้เมื่อลูกค้าจ่ายเงิน
- **Accrual basis** สำหรับค่าใช้จ่าย — รับรู้เมื่อเกิดรายการ
- **Straight-line interest** — ดอกเบี้ยเช่าซื้อรับรู้แบบ straight-line (ไม่ใช้ effective interest rate method)
- ดอกเบี้ยรับรู้ **upfront ณ วันเปิดสัญญา** เป็นส่วนหนึ่งของ HP Receivable (policy decision — ดู N-005 สำหรับ future consideration)

## VAT Policy
- **SHOP** ไม่จด VAT → ไม่คิด VAT
- **FINANCE** จด VAT 7% → คิดจาก (เงินต้น + ค่าคอม + ดอกเบี้ย) ← **CR-001 deferred**: ต้องปรึกษานักบัญชีว่าดอกเบี้ยเช่าซื้อตาม ม.81(1)(ช) ควรยกเว้น VAT หรือไม่
- **ค่าปรับล่าช้า (Late fees) ไม่คิด VAT** — policy decision ของเจ้าของ (ถูกต้องตามกฎหมาย: ค่าปรับไม่อยู่ในฐาน VAT)
- **ไม่มีภาษีหัก ณ ที่จ่าย (WHT)** สำหรับธุรกรรมกับลูกค้า

## Chart of Accounts (Key Codes)
```
11-1101  เงินสด/ธนาคาร (Cash & Bank)
11-2102  ลูกหนี้เช่าซื้อ (HP Receivable)
11-2103  ค่าเผื่อหนี้สงสัยจะสูญ (Allowance for Doubtful)
11-3101  สินค้าคงเหลือ — เครื่องใหม่ (Inventory New)
11-3102  สินค้าคงเหลือ — มือสอง (Inventory Used)
11-4101  ภาษีซื้อ (VAT Input)
21-2101  ภาษีขาย (VAT Output)
21-5101  เครดิตลูกค้า (Customer Credit)
41-1101  รายได้ขายเครื่องใหม่ (Revenue New)
41-1102  รายได้ขายมือสอง (Revenue Used)
42-1102  รายได้ค่าปรับล่าช้า (Late Fee Income)
42-1105  รายได้ค่าคอมมิชชัน (Commission Income)
51-1101  ต้นทุนขายเครื่องใหม่ (COGS New)
51-1102  ต้นทุนขายมือสอง (COGS Used)
53-1101  หนี้สูญ (Bad Debt Expense)
```

## Journal Entries (Auto-generated)

### Payment Received
```
Dr. Cash/Bank              [amountPaid]
  Cr. HP Receivable        [principal + interest]
  Cr. Commission Income    [monthlyCommission]
  Cr. VAT Output           [vatAmount]
  Cr. Late Fee Income      [lateFee — if any, NOT VAT]
```

### Contract Activation
```
Dr. HP Receivable          [financedAmount + interest + commission + VAT]
  Cr. Revenue              [sellingPrice + interest + commission]
  Cr. VAT Output           [vatAmount]
Dr. COGS                   [costPrice]
  Cr. Inventory            [costPrice]
```

### Bad Debt Write-Off
```
Dr. Bad Debt Expense       [writeOffAmount - provisionAmount]
Dr. Allowance for Doubtful [provisionAmount — if any]
  Cr. HP Receivable        [writeOffAmount]
```

### Expense Paid
```
Dr. Expense Account        [amount excl. VAT]
Dr. VAT Input              [vatAmount — if any]
  Cr. Cash/Bank            [totalAmount]
```

## Inter-Company Transactions
- ใช้ **single `InterCompanyTransaction` record** (ไม่ใช่ double-entry ข้ามนิติบุคคล)
- เหตุผล: ปัจจุบันยังเป็นนิติบุคคลเดียวกัน — เมื่อแยกนิติบุคคลจริงต้อง refactor เป็น double-entry
- Track FINANCE↔SHOP flows ผ่าน `ownedByCompanyId` บน Product

## Deferred Items
- **CR-001**: VAT on interest — รอ business decision จากเจ้าของ + นักบัญชี
- **N-005**: Interest recognized upfront vs accrual ตามงวด — ต้อง CPA review
- **GFIN integration**: รอ API spec จาก partner
