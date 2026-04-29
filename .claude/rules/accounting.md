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

## Multi-Entity Chart Partition (Phase A.1a)

ระบบใช้ **2 ผังบัญชี** แยกตาม entity:
- **SHOP chart** (109 acc.) — `docs/references/owner-chart-of-accounts.csv` — สำหรับ SHOP transactions (cash sale, expense, commission income)
- **FINANCE chart** (41 acc.) — `docs/references/finance-chart-of-accounts.csv` — สำหรับ HP transactions (receivable, interest, late fee, bad debt)

Schema: `ChartOfAccount.companyId` + `@@unique([companyId, code])` — same code can exist in both charts (e.g., 11-1101 Cash for SHOP and 11-1101 Cash for FINANCE — different bank accounts).

Validation: `JournalAutoService.createAndPost` looks up accounts scoped to the JE's `companyId`. Posting an account that doesn't exist in this company's chart → throws BadRequestException.

## Chart of Accounts (Key Codes)

### SHOP chart (selected)
```
11-1101  เงินสด — สุทธินีย์ คงเดช (Cash on Hand SHOP)
11-1201  ธนาคาร KBank — เบสท์ช้อยส์โฟน (per owner CoA)
41-1101  รายได้ มือถือ (ใหม่) (Revenue New)
41-1102  รายได้ มือถือ (มือสอง) (Revenue Used)
42-1105  รายได้ค่านายหน้า/คอมมิชชัน — used in A.1b inter-company
51-1101  ต้นทุนมือถือ (ใหม่) (COGS New)
51-1102  ต้นทุนมือถือ (มือสอง) (COGS Used)
11-3101  Inventory ใหม่
11-3102  Inventory มือสอง
11-2105  ลูกหนี้คู่ค้า — FINANCE (Due-from-FINANCE) — A.1b clearing
```

### FINANCE chart (selected)
```
11-1101  เงินสด FINANCE (different bank from SHOP's 11-1101!)
11-2102  ลูกหนี้เช่าซื้อ (HP Receivable)
11-2103  หัก: ค่าเผื่อหนี้สงสัยจะสูญ (Allowance for Doubtful)
11-3103  สินค้ายึดคืน (Repossessed Inventory)
11-3104  Inventory FINANCE — เครื่องใหม่
11-3105  Inventory FINANCE — มือสอง
11-4101  ภาษีซื้อ (VAT Input)
21-1102  เจ้าหนี้คู่ค้า — SHOP (Due-to-SHOP) — A.1b clearing
21-2101  ภาษีขาย ภ.พ.30 (VAT Output)
21-2104  ภาษีขายดอกเบี้ยรอตัดบัญชี [DEFERRED CR-001]
21-2202  รายได้ดอกเบี้ยรอตัดบัญชี [DEFERRED W-003 unearnedInterest]
21-5101  เงินเกินของลูกค้า (Customer Credit Balance)
41-2101  รายได้ขายเช่าซื้อ FINANCE
41-2102  รายได้ขายเช่าซื้อมือสอง FINANCE
42-2101  รายได้ดอกเบี้ยเช่าซื้อ (HP Interest Income) — was 42-1101 (Rounding Excess in owner CoA!)
42-2102  ค่างวดเบี้ยปรับล่าช้า (Late Fee Income) — was 42-1102 (Bank Interest in owner CoA!)
42-2104  รายได้จากการยึดเครื่อง (Repossession Income)
42-2105  รายได้คอมมิชชันจาก SHOP (A.1b inter-company)
51-2101  ต้นทุนขายเช่าซื้อ FINANCE — เครื่องใหม่
51-2102  ต้นทุนขายเช่าซื้อ FINANCE — มือสอง
53-1701  หนี้สูญ (Bad Debt Expense) — was 53-1101 (Salary in owner CoA!)
53-1801  ค่านายหน้าจ่าย SHOP (Commission Expense, A.1b)
```

### Phase A.1a temporary deviations

- **Commission**: temporarily removed from payment JE (folded into HP_RECEIVABLE credit). Sentry alarm fires when monthlyCommission > 0. A.1b restores as proper inter-company JE (FINANCE expense + SHOP income).
- **Contract activation**: posts entirely on FINANCE side in A.1a (down payment, COGS, revenue all FINANCE). A.1b will split — SHOP posts revenue + COGS, FINANCE posts HP Receivable + Due-to-SHOP.

## Journal Entries (Auto-generated)

### Payment Received (FINANCE)
```
Dr. 11-1101 Cash/Bank FINANCE          [amountPaid]
  Cr. 11-2102 HP Receivable            [principal + interest + commission folded in A.1a]
  Cr. 21-2101 VAT Output               [vatAmount]
  Cr. 42-2102 Late Fee Income          [lateFee — if any, NOT VAT]
```
Note: A.1a folds commission into HP Receivable credit (Sentry alarms if monthlyCommission > 0). A.1b will restore as inter-company entry.

### Contract Activation (FINANCE — A.1a single-side)
```
Dr. 11-2102 HP Receivable              [financedAmount + interest + commission + VAT]
  Cr. 41-2101/02 Revenue FINANCE       [sellingPrice + interest + commission]
  Cr. 21-2101 VAT Output               [vatAmount]
Dr. 51-2101/02 COGS FINANCE            [costPrice]
  Cr. 11-3104/05 Inventory FINANCE     [costPrice]
```
Note: A.1b will split — SHOP posts 41-1101/02 Revenue + 51-1101/02 COGS + 11-2105 Due-from-FINANCE; FINANCE posts 11-2102 HP Receivable + 21-1102 Due-to-SHOP.

### Bad Debt Write-Off (FINANCE)
```
Dr. 53-1701 Bad Debt Expense           [writeOffAmount - provisionAmount]
Dr. 11-2103 Allowance for Doubtful     [provisionAmount — if any]
  Cr. 11-2102 HP Receivable            [writeOffAmount]
```
Note: 53-1701 (was 53-1101 in owner CoA = Salary!). Critical remap fixed in Phase A.1a.

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
