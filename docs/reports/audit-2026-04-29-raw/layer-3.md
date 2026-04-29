# Layer 3 — CoA Reconciliation

**Audit date:** 2026-04-29
**System CoA:** `apps/api/prisma/seeds/chart-of-accounts.ts` — 76 seeded accounts
**Owner CoA:** `docs/references/owner-chart-of-accounts.csv` — 109 accounts
**Journal references scanned:** journal-auto.service.ts, accounting.service.ts, data-audit.service.ts

## 3.1 MISSING (owner has, system lacks)

15 codes; 9 operationally significant.

| Code | Owner name | Notes |
|------|-----------|-------|
| 11-1000 | สินทรัพย์หมุนเวียน (header) | Owner top-level; system uses 11-0000 |
| 11-4103 | ภาษีถูกหัก ณ ที่จ่าย | WHT receivable |
| 12-2000 | สินทรัพย์ไม่หมุนเวียน (header) | System uses 12-0000 |
| 12-2108 | ค่าเสื่อมราคา - ยานพาหนะ | Vehicle depreciation contra |
| 21-1102 | เจ้าหนี้ค่าใช้จ่ายกิจการ | General AP |
| 21-2103 | ภ.พ.36 ค้างจ่าย | VAT on foreign payments |
| 21-3201 | เจ้าหนี้สรรพากร ภ.พ.30 รอชำระ | Net VAT payable |
| 21-3202 | เจ้าหนี้สรรพากร ภ.ง.ด.53 รอชำระ | Net PND.53 payable |
| 21-4101 | ลูกค้าโอนเงินผิดพลาด | Suspense |
| 21-4102 | เงินค้ำประกันพนักงาน | Employee deposits |
| 32-1101 | กำไร(ขาดทุน)สะสม | Owner retained earnings; system uses 32-1001 |
| 52-1105 | ส่วนลดไม่จ่ายเศษสตางค์ | Owner code |
| 53-1105 | ค่าอบรม สัมมนา | Owner: Training; system uses 53-1104 |
| 53-1106 | ค่าสวัสดิการอาหาร เครื่องดื่ม | Owner-only |
| 53-1203 | อากรแสตมป์ | Stamp duty |

```yaml
- id: F-3-001
  severity: CRITICAL
  layer: 3
  title: WHT Receivable (11-4103) missing from system CoA
  location:
    - docs/references/owner-chart-of-accounts.csv:20
    - apps/api/prisma/seeds/chart-of-accounts.ts
  evidence: |
    Owner: 11-4103 = ภาษีถูกหัก ณ ที่จ่าย. System: absent.
  impact: |
    Cannot record WHT certificates received from customers/partners.
    PEAK sync would lack WHT receivable account.
  recommendation: |
    Add 11-4103 ภาษีถูกหัก ณ ที่จ่าย under 11-41XX in seed.

- id: F-3-002
  severity: CRITICAL
  layer: 3
  title: ภ.พ.36 Payable (21-2103) missing — needed for foreign SaaS/cloud payments
  location:
    - docs/references/owner-chart-of-accounts.csv:41
    - apps/api/prisma/seeds/chart-of-accounts.ts
  evidence: |
    Owner: 21-2103 = ภ.พ.36 ค้างจ่าย. System: absent.
  impact: |
    AI services, SaaS to foreign vendors require PP.36. VAT to Revenue Dept on foreign services unrecorded.
  recommendation: |
    Add 21-2103 under 21-21XX. Update expense JE for foreign vendors.

- id: F-3-003
  severity: CRITICAL
  layer: 3
  title: Net Tax Payable section (21-32XX) missing — ภ.พ.30 net settlement untrackable
  location:
    - docs/references/owner-chart-of-accounts.csv:46-48
    - apps/api/prisma/seeds/chart-of-accounts.ts
  evidence: |
    Owner: 21-3201 (PP.30 net), 21-3202 (PND.53 net). System: entire group absent.
  impact: |
    Monthly VAT netting has no posting account. Tax reports can't produce net amount as proper liability.
  recommendation: |
    Add 21-32XX group + 21-3201/21-3202. Update monthly close JE.

- id: F-3-004
  severity: WARNING
  layer: 3
  title: Stamp duty account (53-1203) missing
  location:
    - docs/references/owner-chart-of-accounts.csv:96
  evidence: |
    Owner: 53-1203 = อากรแสตมป์. System: only 53-1201/53-1202.
  impact: |
    Stamp duty on installment contracts (฿1 per ฿2,000 HP) has no dedicated account.
  recommendation: |
    Add 53-1203 อากรแสตมป์ under 53-12XX.

- id: F-3-005
  severity: WARNING
  layer: 3
  title: Employee deposit (21-4102) and wrong-transfer suspense (21-4101) missing
  location:
    - docs/references/owner-chart-of-accounts.csv:50-51
  evidence: |
    Owner: 21-4101/21-4102. System: 21-41XX has 21-4201/21-4202 (different codes).
  impact: |
    Wrong transfer receipts + employee deposits have no proper holding account.
  recommendation: |
    Align advance receipt accounts. Add missing accounts.

- id: F-3-006
  severity: WARNING
  layer: 3
  title: Retained earnings code mismatch (system 32-1001 vs owner 32-1101)
  location:
    - apps/api/prisma/seeds/chart-of-accounts.ts:109
    - docs/references/owner-chart-of-accounts.csv:59
  evidence: |
    System 32-1001 vs Owner 32-1101 (same name).
  impact: |
    PEAK integration would map RE to wrong code.
  recommendation: |
    Rename to 32-1101 via migration; @map for backward compat.

- id: F-3-007
  severity: WARNING
  layer: 3
  title: Vehicle depreciation contra account (12-2108) missing
  location:
    - docs/references/owner-chart-of-accounts.csv:30
  evidence: |
    System has 12-2107 (Vehicles) but no accumulated depreciation contra.
  impact: |
    Vehicle depreciation can't book as contra asset. Net book value overstated.
  recommendation: |
    Add 12-2108 under 12-21XX.
```

## 3.2 EXTRA (system has, owner lacks)

15 codes. Most are FINANCE-side HP accounts owner CoA (single-entity SHOP design) doesn't model.

| Code | System name | Severity | Reason |
|------|------------|---------|--------|
| 11-0000 | Header L1 | INFO | Owner uses 11-1000 |
| 11-2102 | ลูกหนี้เช่าซื้อ | WARNING | Core HP; owner has none |
| 11-2103 | ค่าเผื่อหนี้สงสัยจะสูญ | WARNING | Owner has no allowance |
| 11-2104 | ลูกหนี้ไฟแนนซ์ภายนอก | INFO | GFIN deferred |
| 11-3103 | สินค้ายึดคืน/ซ่อมแล้ว | WARNING | Repossession inv |
| 12-0000 | Header L1 | INFO | Owner uses 12-2000 |
| 21-4201 | เงินรับล่วงหน้า | WARNING | Conflicts with owner 21-4101 |
| 21-4202 | เงินมัดจำรับ | WARNING | Conflicts with owner 21-4102 |
| 21-5101 | เงินเกินของลูกค้า | WARNING | Owner has no customer credit |
| 32-1001 | กำไร(ขาดทุน)สะสม | WARNING | Owner uses 32-1101 |
| 41-1103 | รายได้ไฟแนนซ์ภายนอก | INFO | GFIN deferred |
| 42-1105 | รายได้ค่านายหน้า | CRITICAL | Actively journal-posted; owner has none |
| 53-0102 | โบนัส | WARNING | Non-standard (owner has 53-1104) |
| 53-0116 | ค่าสวัสดิการ | WARNING | Non-standard (owner has 53-1106) |
| 53-0509 | ค่ากรรมสิทธิ์ | INFO | System-only |

```yaml
- id: F-3-008
  severity: CRITICAL
  layer: 3
  title: Commission Income (42-1105) journal-posted but absent from owner CoA
  location:
    - apps/api/prisma/seeds/chart-of-accounts.ts:137
    - apps/api/src/modules/journal/journal-auto.service.ts:40,194
  evidence: |
    System: 42-1105 = รายได้ค่านายหน้า/คอมมิชชัน, allowedCompanies: ['SHOP'].
    Journal-auto: ACC.COMMISSION_INCOME='42-1105' — posted on every payment.
    Owner CoA: 42-1105 absent; no commission income account at all.
  impact: |
    Every HP payment auto-journal credits commission income to non-existent owner account.
    PEAK sync would fail to match chart. Owner TB never sees commission income.
  recommendation: |
    Owner + accountant decide: (a) add 42-1105 to owner CoA, or (b) route to existing owner account.

- id: F-3-009
  severity: WARNING
  layer: 3
  title: HP Receivable (11-2102) and related HP accounts in system not in owner CoA
  location:
    - apps/api/prisma/seeds/chart-of-accounts.ts:38-40
  evidence: |
    System: 11-2102 (HP Recv), 11-2103 (Allowance), 11-2104 (Ext Finance Recv).
    Owner: only 11-2101 (ลูกหนี้การค้า).
  impact: |
    Owner CoA designed for single-entity SHOP. System's FINANCE-side HP model doesn't align.
    Monthly BS in owner's PEAK wouldn't reflect HP receivable.
  recommendation: |
    Owner + CPA decide: extend owner CoA to include FINANCE accounts, or maintain separate FINANCE chart.

- id: F-3-010
  severity: WARNING
  layer: 3
  title: Customer Credit Balance (21-5101) absent from owner; not used in journal either
  location:
    - apps/api/prisma/seeds/chart-of-accounts.ts:96
    - apps/api/src/modules/journal/journal-auto.service.ts:35
  evidence: |
    System: 21-5101 defined, ACC constant exists, never passed to createAndPost lines. Owner: absent.
  impact: |
    Overpayments can't be formally recognized in GL. Double orphan: missing owner + unused journal.
  recommendation: |
    Add to owner CoA AND implement JE for overpayment in createPaymentJournal.

- id: F-3-011
  severity: WARNING
  layer: 3
  title: Bonus (53-0102) and Welfare (53-0116) use non-standard codes
  location:
    - apps/api/prisma/seeds/chart-of-accounts.ts:157-158
  evidence: |
    System: 53-0102 = โบนัส, 53-0116 = ค่าสวัสดิการ (under 53-0000 direct).
    Owner: 53-1104 = โบนัส, 53-1106 = ค่าสวัสดิการอาหาร (under 53-11XX group).
    Two different codes for same concepts; both exist in system.
  impact: |
    Expense entries may use either code. Duplicate accounts cause P&L double-counting risk.
  recommendation: |
    Remove 53-0102 + 53-0116 from system. Consolidate to owner codes.
```

## 3.3 MISMATCH (same code, different name)

**Most severe section.** 32 codes exist in both with different names.

### Critical semantic collisions (journal-active)

| Code | System | Owner | Journal active? |
|------|--------|-------|---------------|
| 42-1101 | HP Interest Income | รายได้ส่วนเกินจากการปัดเศษ | YES |
| 42-1102 | ค่างวดเบี้ยปรับล่าช้า | ดอกเบี้ยเงินฝาก | YES |
| 42-1103 | ค่ามัดจำริบ | ค่าปรับชำระล่าช้า | No |
| 42-1104 | รายได้ยึดเครื่อง | รายได้หักค่าจ้าง | No |
| 52-1102 | ค่าส่งเสริมการขาย | ค่าคอมฯ พนักงาน | YES |
| 52-1103 | ค่าบริการ SMS | ค่าส่งเสริมการขาย | No |
| 52-1104 | ส่วนลดเศษสตางค์ | ค่าบริการ SMS | No |

### Personnel block shift (53-11XX)

| Code | System | Owner | Active? |
|------|--------|-------|---------|
| 53-1102 | ค่าคอมฯ พนักงาน | เงินสมทบประกันสังคม | No |
| 53-1103 | ประกันสังคม | ค่าล่วงเวลา | YES |
| 53-1104 | ค่าอบรม | โบนัส | No |

### Professional services shift (53-14XX)

| Code | System | Owner |
|------|--------|-------|
| 53-1401 | ค่าบริการ AI | ค่าบริการบัญชี |
| 53-1402 | ค่าจ้างเขียนโปรแกรม | ค่าบริการ AI |
| 53-1403 | ค่าบริการบัญชี | ค่าจ้างเขียนโปรแกรม |
| 53-1404 | ค่าที่ปรึกษากฎหมาย | ค่าโปรแกรมสำเร็จรูป |
| 53-1405 | ค่าบริการอื่น | ค่าจ้างทนาย |

### Other notables

| Code | System | Owner |
|------|--------|-------|
| 11-1201 | KBank Savings (generic) | ...2031165205 เบสท์ช้อยส์โฟน |
| 11-1202 | SCB Savings (generic) | ...579-413208-8 ค่าใช้จ่าย |
| 11-1203 | KTB Savings | ...579-413209-6 ค่าเสื่อม (SCB!) |
| 21-1103 | เจ้าหนี้ค่าใช้จ่ายบริการ | ค่าโปรแกรม CANVA ค้างจ่าย |
| 21-2102 | ภ.พ.30 ค้างจ่าย | ภาษีขายรอเรียกเก็บ |
| 22-1101 | เงินกู้ยืมระยะยาว | เงินกู้ยืมกรรมการ |

```yaml
- id: F-3-012
  severity: CRITICAL
  layer: 3
  title: "42-1101 collision: system=HP Interest Income, owner=Rounding Excess"
  location:
    - apps/api/prisma/seeds/chart-of-accounts.ts:133
    - apps/api/src/modules/journal/journal-auto.service.ts:38,193,316
    - docs/references/owner-chart-of-accounts.csv:70
  evidence: |
    System 42-1101 = รายได้ดอกเบี้ยเช่าซื้อ. Owner 42-1101 = รายได้ส่วนเกินจากการปัดเศษ.
    journal-auto.ACC.INTEREST_INCOME = '42-1101' — posted on every HP payment.
    Monthly HP payments credit millions of baht to owner's tiny rounding account.
  impact: |
    HP interest income (core FINANCE revenue) posts to owner's rounding surplus account.
    PEAK sync: all interest income appears as rounding errors.
    Owner reports: massively inflated "rounding excess", zero HP interest. P0 PEAK sync blocker.
  recommendation: |
    Owner + CPA add dedicated HP interest income account (e.g. 42-1201). Update ACC.INTEREST_INCOME, re-seed.

- id: F-3-013
  severity: CRITICAL
  layer: 3
  title: "42-1102 collision: system=Late Fee Income, owner=Bank Interest"
  location:
    - apps/api/prisma/seeds/chart-of-accounts.ts:134
    - apps/api/src/modules/journal/journal-auto.service.ts:39,196
    - docs/references/owner-chart-of-accounts.csv:71
  evidence: |
    System 42-1102 = ค่างวดเบี้ยปรับล่าช้า. Owner 42-1102 = ดอกเบี้ยเงินฝาก.
    journal-auto.ACC.LATE_FEE_INCOME = '42-1102' — posted when lateFee > 0.
  impact: |
    Customer late fees booked as bank savings interest in owner's view.
    Bank reconciliation shows unexplained "bank interest" entries.
  recommendation: |
    Add dedicated late fee income account (note: owner's 42-1103 ค่าปรับชำระล่าช้า matches purpose
    but system uses 42-1103 for forfeited deposits). Full 42-11XX block re-alignment needed.

- id: F-3-014
  severity: CRITICAL
  layer: 3
  title: "52-1102 collision: system=Advertising, owner=Employee Commission"
  location:
    - apps/api/prisma/seeds/chart-of-accounts.ts:151
    - apps/api/src/modules/accounting/accounting.service.ts:51
    - docs/references/owner-chart-of-accounts.csv:81
  evidence: |
    System 52-1102 = ค่าส่งเสริมการขาย. Owner 52-1102 = ค่าคอมฯ พนักงาน.
    CATEGORY_CODE_MAP: SELL_ADVERTISING + SELL_PACKAGING both = '52-1102'.
    Entire 52-1102→52-1104 block shifted by 1 vs owner.
  impact: |
    Advertising posts as employee commission in owner view.
    SMS service costs (owner 52-1104) appear as rounding discounts in system.
    P&L line-item breakdown completely misclassified.
  recommendation: |
    Re-align 52-1102 to 52-1105 to match owner ordering. Update CATEGORY_CODE_MAP.

- id: F-3-015
  severity: CRITICAL
  layer: 3
  title: "53-1102/03 shift: Social Security posts to Overtime; Bad Debt to Salary"
  location:
    - apps/api/prisma/seeds/chart-of-accounts.ts:164-165
    - apps/api/src/modules/accounting/accounting.service.ts:52-53
    - docs/references/owner-chart-of-accounts.csv:88-89
  evidence: |
    System 53-1102 = ค่าคอมฯ พนักงาน / Owner 53-1102 = ประกันสังคม
    System 53-1103 = ประกันสังคม / Owner 53-1103 = ค่าล่วงเวลา
    CATEGORY_CODE_MAP: ADMIN_SOCIAL_SECURITY=53-1103, ADMIN_INSURANCE=53-1103 (same code).
  impact: |
    Social security posts to overtime account in owner view.
    Insurance + social security collapsed into same code.
  recommendation: |
    Re-align 53-11XX to match owner's 6-account structure (salary/SSO/overtime/bonus/training/welfare).
    Separate ADMIN_INSURANCE to own account.

- id: F-3-016
  severity: WARNING
  layer: 3
  title: "53-14XX block shifted by 1: AI service expense posts to accounting service"
  location:
    - apps/api/prisma/seeds/chart-of-accounts.ts:183-187
    - docs/references/owner-chart-of-accounts.csv:104-108
  evidence: |
    System: 53-1401=AI, 1402=Software Dev, 1403=Accounting, 1404=Legal, 1405=Other
    Owner: 53-1401=Accounting, 1402=AI, 1403=Software Dev, 1404=SaaS, 1405=Legal
  impact: |
    All professional service expenses misclassified in owner ledger.
  recommendation: |
    Align 53-14XX to owner ordering. Update CATEGORY_CODE_MAP.

- id: F-3-017
  severity: WARNING
  layer: 3
  title: Bank account names don't match owner (11-1201-11-1203)
  location:
    - apps/api/prisma/seeds/chart-of-accounts.ts:31-33
    - docs/references/owner-chart-of-accounts.csv:9-11
  evidence: |
    System 11-1203 = KTB Savings; Owner 11-1203 = SECOND SCB account.
    Owner has 2 SCB accounts; system models KTB which may not exist.
  impact: |
    JEs to 11-1203 (system: KTB) post to second SCB in PEAK → bank rec failure.
  recommendation: |
    Update bank names + verify KTB exists; add account number to nameTh for unambiguous PEAK matching.

- id: F-3-018
  severity: WARNING
  layer: 3
  title: 21-2102 conflict — system=VAT Payable, owner=Unearned VAT
  location:
    - apps/api/prisma/seeds/chart-of-accounts.ts:81
    - docs/references/owner-chart-of-accounts.csv:40
  evidence: |
    System 21-2102 = ภ.พ.30 ค้างจ่าย (filed not paid). Owner 21-2102 = ภาษีขายรอเรียกเก็บ (deferred).
    Different concepts.
  impact: |
    PEAK sync: deferred VAT account receives PP.30 net entries.
  recommendation: |
    Need both accounts: pending invoice VAT + tax payable after netting.
```

## 3.4 STRUCTURE-DIVERGE

4 systematic divergences:

**Divergence 1:** Top-level section codes — System `XX-0000` vs Owner `XX-1000`/`XX-2000`.

**Divergence 2:** Entire 42-11XX block (Other Income) reassigned — 5-account block collision.

**Divergence 3:** 52-11XX selling expense block shifted by 1.

**Divergence 4:** 53-11XX personnel block shifted by 2; system has 4 accounts vs owner 6.

```yaml
- id: F-3-019
  severity: WARNING
  layer: 3
  title: Top-level asset section codes differ (11-0000 vs 11-1000; 12-0000 vs 12-2000)
  location:
    - apps/api/prisma/seeds/chart-of-accounts.ts:21,54
    - docs/references/owner-chart-of-accounts.csv:3,21
  evidence: |
    System 11-0000/12-0000 vs Owner 11-1000/12-2000.
  impact: |
    PEAK account hierarchy import would not align.
    Low impact on JEs (headers not posted) but breaks structural reporting.
  recommendation: |
    Update header codes in seed to match owner.

- id: F-3-020
  severity: CRITICAL
  layer: 3
  title: Entire 42-11XX block — system reassigned 5 codes to FINANCE concepts
  location:
    - apps/api/prisma/seeds/chart-of-accounts.ts:133-137
    - docs/references/owner-chart-of-accounts.csv:70-73
    - apps/api/src/modules/journal/journal-auto.service.ts:38-42
  evidence: |
    System 42-1101-1105 = HP Interest, Late Fee, Forfeited Deposits, Repossession Income, Commission Income
    Owner 42-1101-1104 = Rounding Excess, Bank Interest, Late Penalty, Employee Deduction Income
    Systematic block conflict not one-off mismatch.
  impact: |
    Cannot fix by renaming individual accounts — requires full block re-numbering.
  recommendation: |
    Owner + CPA define new numbering for FINANCE revenue (e.g. 43-XXXX).
    System must not reuse owner's 42-11XX codes. PEAK sync prerequisite.

- id: F-3-021
  severity: WARNING
  layer: 3
  title: 52-11XX block shifted — advertising/SMS/discount misclassified
  location:
    - apps/api/prisma/seeds/chart-of-accounts.ts:150-153
    - apps/api/src/modules/accounting/accounting.service.ts:51
    - docs/references/owner-chart-of-accounts.csv:80-84
  evidence: |
    System 4 accounts (52-1101-1104). Owner 5 accounts (52-1101-1105).
    System inserted "advertising" at 52-1102 displacing owner accounts by 1.
    SELL_ADVERTISING + SELL_PACKAGING both = 52-1102.
  impact: |
    Advertising → employee commission in owner. SMS → advertising. Discounts → SMS.
    SELL_ADVERTISING + SELL_PACKAGING share code — no distinction.
  recommendation: |
    Re-sequence 52-1102 to 52-1105 to match owner. Add 52-1105 for discount. Separate ADV/PACKAGING.

- id: F-3-022
  severity: CRITICAL
  layer: 3
  title: 53-11XX block shifted — Social Security to Overtime; Bad Debt to Salary
  location:
    - apps/api/prisma/seeds/chart-of-accounts.ts:163-166
    - apps/api/src/modules/journal/journal-auto.service.ts:43
    - apps/api/src/modules/accounting/accounting.service.ts:52-53
    - docs/references/owner-chart-of-accounts.csv:87-92
  evidence: |
    System 53-1101 = เงินเดือน (also "Bad Debt Expense" in journal-auto comment).
    journal-auto line 43: ACC.BAD_DEBT_EXPENSE = '53-1101' // หนี้สูญ
    Bad debt write-off DEBITS 53-1101 as หนี้สูญ → posts to Salary in both system seed AND owner CoA.
    Plus 53-1102/03 shifted (system commission/SSO vs owner SSO/overtime).
    CATEGORY_CODE_MAP: 53-1103 used for both ADMIN_SOCIAL_SECURITY + ADMIN_INSURANCE.
  impact: |
    1. Bad debt write-off posts to Salary → Salary inflated, P0 financial integrity.
    2. Social security posts to overtime in owner view.
    3. Insurance + social security same code — no distinction.
  recommendation: |
    IMMEDIATE: Add Bad Debt Expense account (e.g. 53-1701) not in either CoA. Update ACC.BAD_DEBT_EXPENSE.
    MEDIUM: Re-align 53-1102-1106 to owner's 6-account block. Remove ADMIN_INSURANCE duplicate.
```

## 3.5 ORPHAN (in system, no journal use)

47 of 78 level-3 leaf accounts have no reference in journal-posting service files.

WARNING-level orphans (should be journal-active):
- 11-2104 (External Finance Receivable) — GFIN sales should create receivable
- 11-3103 (Repossessed Goods) — repossession adds stock back
- 42-1103 (Forfeited Deposits) — revenue events
- 42-1104 (Repossession Income) — repossession revenue
- 21-5101 (Customer Credit) — overpayments
- 41-1103 (External Finance Sales Revenue) — GFIN
- 41-2101 (Sales Discounts) — should reduce revenue
- 12-2101 to 12-2107 (PP&E + accum dep) — depreciation expense exists but no PP&E posts
- 21-1101 (Trade Payable) — AP for inventory purchases
- 21-3101-21-3103 (WHT Payable) — from expense payments

```yaml
- id: F-3-023
  severity: WARNING
  layer: 3
  title: Repossession income (42-1104) and inventory (11-3103) seeded but never posted
  location:
    - apps/api/prisma/seeds/chart-of-accounts.ts:46,136
    - apps/api/src/modules/repossessions/repossessions.service.ts
  evidence: |
    Accounts exist. repossessions.service only calls createBadDebtWriteOffJournal.
    No JE for repossession income or inventory reinstatement.
  impact: |
    Inventory comeback + receivable settlement + resale value all unrecorded.
  recommendation: |
    Implement createRepossessionJournal: Dr.Repossessed Inventory / Cr.HP Receivable + Cr.Repossession Income.

- id: F-3-024
  severity: WARNING
  layer: 3
  title: PP&E (12-21XX) + depreciation (53-16XX) seeded but no journal posts
  location:
    - apps/api/prisma/seeds/chart-of-accounts.ts:57-64,196-200
  evidence: |
    Zero journal references to PP&E or depreciation codes.
    No monthly depreciation journal implemented.
  impact: |
    Monthly depreciation not auto-posted. Net book value overstated. No depreciation in P&L.
  recommendation: |
    Add monthly depreciation cron + createDepreciationJournal. Or document as deferred.

- id: F-3-025
  severity: INFO
  layer: 3
  title: 47 of 78 level-3 accounts have no journal reference (full orphan list)
  location:
    - apps/api/prisma/seeds/chart-of-accounts.ts
  evidence: |
    Includes: petty cash sub-accounts, bank accounts, trade receivable/payable,
    WHT payable, advance/deposit, long-term loans, sales discount, SMS, depreciation, tax expense.
  impact: |
    Some (21-1101 trade payable, 11-1201-1203 bank accounts) should receive postings
    but bypassed by current journal using 11-1101 (cash) catch-all.
  recommendation: |
    Audit which orphans are gaps vs intentional. Highest priority: bank differentiation, trade payable.
```

## 3.6 UNDEFINED-USAGE

All 31 codes in journal services exist in system seed. No "code missing" errors. **However, three codes are used with fundamentally wrong semantic meaning** (covered in 3.3 and 3.4).

```yaml
- id: F-3-026
  severity: CRITICAL
  layer: 3
  title: ACC.BAD_DEBT_EXPENSE points to Salary account
  location:
    - apps/api/src/modules/journal/journal-auto.service.ts:43,426
    - apps/api/prisma/seeds/chart-of-accounts.ts:163
  evidence: |
    journal-auto line 43: BAD_DEBT_EXPENSE: '53-1101' // หนี้สูญ
    seed line 163: { code: '53-1101', nameTh: 'เงินเดือน ค่าจ้าง', ... }
    accounting.md says 53-1101 = หนี้สูญ but seed defines as Salaries. Comment is wrong.
    Bad debt write-off (line 426) DEBITS เงินเดือน as ค่าใช้จ่ายหนี้สูญ.
  impact: |
    Every bad-debt write-off creates: Dr.Salary / Cr.HP Receivable.
    Bad debt inflates salary expense on P&L. Violates account nature (operating vs credit risk).
    accounting.md is also wrong — must be corrected with seed.
  recommendation: |
    IMMEDIATE:
    1. Add new account 53-1701 หนี้สูญ
    2. Update ACC.BAD_DEBT_EXPENSE
    3. Update accounting.md
    4. Backfill: reverse all existing bad-debt JEs that used 53-1101, re-post to 53-1701.
```

## 3.7 ALLOWED-COMPANY-VIOLATION

`allowedCompanies` enforced **only in journal.service.ts** (manual API). `journal-auto.service.ts` `createAndPost` does **NOT** validate. Restricted accounts posted without check:

| Account | Restriction | JE method | companyId? |
|---------|------------|----------|----------|
| 11-2102 | FINANCE | Payment, Activation, BadDebt | No (resolveCompanyId) |
| 42-1101 | FINANCE | Payment, Activation | No |
| 42-1102 | FINANCE | Payment | No |
| 42-1105 | SHOP | Payment | No |
| 11-4101 | FINANCE | Expense | No |
| 21-2101 | FINANCE | Payment | No |

`resolveCompanyId` (lines 59-69): findFirst no ORDER BY → non-deterministic.

```yaml
- id: F-3-027
  severity: CRITICAL
  layer: 3
  title: journal-auto bypasses allowedCompanies — FINANCE accounts can post under SHOP
  location:
    - apps/api/src/modules/journal/journal-auto.service.ts:75-127,59-69
    - apps/api/src/modules/payments/payments.service.ts:184-199
    - apps/api/src/modules/contracts/contract-workflow.service.ts:429-442
  evidence: |
    createAndPost: no ChartOfAccount lookup, no allowedCompanies check.
    resolveCompanyId: findFirst with no ORDER BY → non-deterministic which company first.
    payments.service.ts and contract-workflow.service.ts call without companyId.
  impact: |
    Under race conditions or DB ordering, HP installment payment journals could post to SHOP
    even though 11-2102, 42-1101/02, 21-2101 are FINANCE-only.
    42-1105 (SHOP-only) posted with FINANCE → wrong entity attribution.
    Would fail manual entry validation if replayed. Breaks PEAK sync entity-account separation.
  recommendation: |
    1. Add allowedCompanies validation inside createAndPost(): query ChartOfAccount per code,
       check against companyCode. Throw BadRequestException if violation.
    2. Fix resolveCompanyId() add ORDER BY.
    3. Pass explicit companyId from callers.

- id: F-3-028
  severity: CRITICAL
  layer: 3
  title: Commission Income (42-1105) is SHOP-only but posted from FINANCE-context payment
  location:
    - apps/api/prisma/seeds/chart-of-accounts.ts:137
    - apps/api/src/modules/journal/journal-auto.service.ts:40,194
    - apps/api/src/modules/payments/payments.service.ts:184
  evidence: |
    Seed: 42-1105 allowedCompanies: ['SHOP'].
    createPaymentJournal always credits 42-1105.
    Payments to FINANCE → companyId resolves to FINANCE → 42-1105 (SHOP-only) violation.
  impact: |
    Commission income misattributed between entities.
    Inter-company commission flow not properly separated in GL.
  recommendation: |
    Commission income on HP payment belongs to SHOP. Payment JE (FINANCE) should NOT include commission.
    Separate SHOP-side JE when FINANCE settles with SHOP. Inter-company journal design needed.
```

## Summary

**FAIL** — 11 CRITICAL, 14 WARNING, 1 INFO findings (28 total)

**Highest-priority before PEAK sync:**
1. F-3-026: Fix BAD_DEBT_EXPENSE → new account, not 53-1101
2. F-3-027: Add allowedCompanies validation in createAndPost() + fix resolveCompanyId
3. F-3-020 + F-3-012 + F-3-013: Re-number 42-11XX block
4. F-3-022: Re-align 53-11XX to owner 6-account structure
