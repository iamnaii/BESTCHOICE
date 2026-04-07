# SPEC: Accounting Journal System (Auto Double-Entry Bookkeeping)

> Project: BESTCHOICE
> Priority: HIGH
> Status: PLANNED — แยกจาก Improvement Plan Phase 2
> Created: 2026-04-07

## Background

ปัจจุบันระบบ BESTCHOICE มี:
- Journal Entry model + service (สร้าง/post/void ได้)
- Chart of Account model
- P&L report (accounting.service.ts)
- Balance Sheet (accounting.service.ts)
- Expense CRUD with approval workflow

**สิ่งที่ขาด:** ไม่มีการสร้าง Journal Entry อัตโนมัติเมื่อเกิด financial transaction — ต้อง manual ทุกรายการ

## Scope

### 1. Auto Journal Entry — Payment Received
เมื่อ recordPayment() ใน payments.service.ts สำเร็จ ต้องสร้าง:
```
Dr. Cash/Bank (1110)              [amountPaid]
  Cr. Hire-Purchase Receivable (1220)  [monthlyPrincipal]
  Cr. Interest Income (4210)           [monthlyInterest]
  Cr. Commission Income (4400)         [monthlyCommission]
  Cr. VAT Payable (2110)              [vatAmount]
  Cr. Late Fee Income (4300)           [lateFee — if any]
```

### 2. Auto Journal Entry — Expense Paid
เมื่อ markExpensePaid() สำเร็จ ต้องสร้าง:
```
Dr. [Expense Account by category]     [amount]
Dr. VAT Input (1140)                  [vatAmount — if any]
  Cr. Cash/Bank (1110)                [totalAmount]
```

### 3. Auto Journal Entry — Contract Activated (Inter-Company)
เมื่อ contract status → ACTIVE:
```
FINANCE books:
Dr. Hire-Purchase Receivable (1220)    [financedAmount]
  Cr. Sales Revenue (4100)             [principal + interest]
  Cr. Commission Payable (2120)        [storeCommission]
  Cr. VAT Payable (2110)              [vatAmount]

SHOP books:
Dr. Commission Receivable (1230)       [storeCommission]
Dr. Cash/Bank (1110)                   [downPayment]
  Cr. Sales Revenue (4100)             [sellingPrice]
  Cr. Inventory (1300)                 [costPrice — COGS]
```

### 4. Auto Journal Entry — Receipt Voided
เมื่อ voidReceipt() สำเร็จ → สร้าง reversal entry (debit↔credit สลับกัน)

### 5. Trial Balance Report
- Query all JournalEntryLine grouped by accountCode
- Sum debit, sum credit per account
- Verify total debit = total credit

## Technical Approach

### Option A: Event-Driven (Recommended)
- สร้าง `JournalAutoService` ที่มี methods:
  - `createPaymentJournal(payment, contract, companyId)`
  - `createExpenseJournal(expense, companyId)`
  - `createContractActivationJournal(contract, sale, companyId)`
  - `createReversalJournal(originalEntryId)`
- เรียกจาก existing services หลัง transaction สำเร็จ

### Option B: Prisma Middleware
- Intercept Payment/Expense updates → auto-create journal
- ข้อเสีย: ซับซ้อน, debug ยาก

## Chart of Account Codes (PEAK Format)

| Code | Name | Type |
|------|------|------|
| 1110 | เงินสด/ธนาคาร | Asset |
| 1140 | ภาษีซื้อ (VAT Input) | Asset |
| 1220 | ลูกหนี้เช่าซื้อ | Asset |
| 1230 | ลูกหนี้การเงินรับ | Asset |
| 1300 | สินค้าคงเหลือ | Asset |
| 2110 | ภาษีขาย (VAT Output) | Liability |
| 2120 | เจ้าหนี้ค่าคอมมิชชัน | Liability |
| 4100 | รายได้จากการขาย | Revenue |
| 4210 | รายได้ดอกเบี้ย | Revenue |
| 4300 | รายได้ค่าปรับล่าช้า | Revenue |
| 4400 | รายได้ค่าคอมมิชชัน | Revenue |
| 51-1101 | ต้นทุนสินค้า | Expense |

## Business Rules
- VAT ค่าปรับล่าช้า: ไม่คิด (confirmed by owner)
- หัก ณ ที่จ่าย: ไม่มี (confirmed by owner)
- Accounting basis: Cash basis สำหรับรายได้, Accrual basis สำหรับค่าใช้จ่าย
- มาตรฐาน: TFRS for NPAEs

## Dependencies
- Existing: JournalService, ChartOfAccount model, AccountingService
- ต้องมี: Seed chart of account codes ก่อนใช้งาน

## Estimated Effort
- JournalAutoService: 2-3 days
- Integration with existing services: 2-3 days
- Trial Balance report: 1 day
- Testing + verification: 2 days
- **Total: ~1-2 weeks**
