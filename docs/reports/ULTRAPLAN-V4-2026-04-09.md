# Ultraplan v4 — Hardening Sprint (2026-04-09)

**สถานะ**: Proposed
**Branch**: `claude/ultraplan-setup-I9ibR`
**Baseline**: 48 API modules, 75 Prisma models, 90 migrations, 400 API tests (21 suites), 129 web tests (11 files), 33 E2E specs, TypeScript 0 errors

---

## Executive Summary

หลังจาก v1-v3 ปิดช่องโหว่ security/correctness ใหญ่ๆ ไปแล้ว — account lockout, cascade-restrict, webhook idempotency, bundle split, 66+ tests — v4 ควรโฟกัส **"สิ่งที่เงียบแต่กำลังรั่ว"**:

1. **Decimal precision leaks** — 50 จุดใน 10 services ยังใช้ `Number()` บน Prisma Decimal (รวม accounting.service.ts 24 จุด, journal-auto.service.ts ทุก method, balance sheet + cash flow) → เสี่ยงเงินหายที่ทศนิยม + ส่งผลให้ journal entry unbalanced silently
2. **Cron silent failures** — v2 เคลมว่าครอบคลุม "17 cron jobs" แต่ยัง **มี 5 cron jobs ไม่ต่อ Sentry** (depreciation รายเดือน, token cleanup, verification, auto-trigger × 2) → ถ้าล้มเงียบไม่มีคนรู้
3. **Test gap ใน core services** — `accounting.service.ts` (1115 บรรทัด), `payments.service.ts` (799 บรรทัด), และ `journal-auto.service.ts` ยังไม่มี spec เฉพาะ → ไม่มี safety net รอบ trial balance
4. **Frontend inconsistency** — 3 หน้ายังใช้ `confirm()`/`alert()`, 2 จุด hardcoded `localhost:3457` raw fetch, 6 หน้า data-fetching ยังไม่มี QueryBoundary
5. **DevOps gaps** — backup replication off-site ยังไม่มี, ChatMessage/DocumentAuditLog retention ค้างจาก v3
6. **Accounting — 2 silent bugs ⚠️** (จากการตรวจเจาะลึก 2026-04-09, ดู Phase 4):
   - **N-002**: Journal entry ไม่ balance → `logger.warn()` + `return null` (ไม่ throw, ไม่ Sentry) → transaction สำเร็จแต่ไม่มี journal → งบการเงินผิด เงียบ
   - **N-003**: `writeOffBadDebt` ไม่สร้าง journal entry → Balance Sheet ยังแสดง HP Receivable หลังตัดหนี้สูญ
7. **UX/UI debt — 5 Critical 0/5 fully fixed** (จาก audit 2026-04-06, ดู Phase 5):
   - `components/ui/breadcrumb.tsx` มี แต่ **0 pages import ใช้**
   - react-hook-form + zod + form wrapper ติดตั้ง แต่ **0 pages ใช้ `useForm`** → ไม่มี inline validation
   - ContractCreatePage ไม่มี auto-save → browser crash = ข้อมูลหาย
   - 6 จุด `alt=""` ยังอยู่ (+1 จาก 2026-04-06 เพราะไม่มี ESLint rule กัน)
   - ไม่มี `useCopyToClipboard` hook — copy inline 4 จุดแบบซ้ำ ๆ

**Target**: 4 PRs (v4.1-v4.4), ~95-110 tasks รวมทั้ง 5 phases. **Phase 4.1-4.2 + Phase 5A เป็น P0 — ต้องรวมใน PR v4.1**

---

## Phase 1 — Silent Bleeders (Low risk, High value)

**Theme**: ปิดจุดที่รั่วเงียบ — ไม่มีใครรู้ว่าพัง

### Tasks

| # | Task | File(s) | Effort | Risk |
|---|------|---------|--------|------|
| 1.1 | Sentry capture ใน `@Cron('30 0 1 * *')` monthly depreciation — critical, ถ้าล้มไม่มี depreciation entry | `apps/api/src/modules/asset/asset.service.ts:380` | S | Low |
| 1.2 | Sentry capture ใน `@Cron(EVERY_DAY_AT_3AM)` refresh token cleanup | `apps/api/src/modules/auth/auth-token-cleanup.service.ts:16` | S | Low |
| 1.3 | Sentry capture ใน `@Cron(EVERY_10_MINUTES)` LINE OTP verification cleanup | `apps/api/src/modules/chatbot-finance/services/verification.service.ts:206` | S | Low |
| 1.4 | Sentry capture ใน 2 crons ของ auto-trigger (09:00 dunning, 10:00 reminders) | `apps/api/src/modules/chatbot-finance/services/auto-trigger.service.ts:48,59` | S | Low |
| 1.5 | แทน `confirm('ลบรายการนี้?')` → `shadcn AlertDialog` หรือ toast-based confirm ใน TodosPage | `apps/web/src/pages/TodosPage.tsx:613` | S | Low |
| 1.6 | แทน `window.confirm('ต้องการลบโปรโมชันนี้?')` ใน PromotionsPage | `apps/web/src/pages/PromotionsPage.tsx:254` | S | Low |
| 1.7 | แทน `confirm(ลบบัญชี...)` ใน ChartOfAccountsPage | `apps/web/src/pages/ChartOfAccountsPage.tsx:294` | S | Low |
| 1.8 | รวม hardcoded `http://localhost:3457/api/read-card` → ใช้ `cardReader.ts` util ที่มีอยู่แล้ว | `apps/web/src/pages/TradeInPage.tsx:328`, `apps/web/src/components/trade-in/QuickBuyModal.tsx:137` | S | Low |
| 1.9 | เพิ่ม QueryBoundary ใน `ExchangePage` — มี useQuery แต่ยังไม่ wrap | `apps/web/src/pages/ExchangePage.tsx` | S | Low |
| 1.10 | เพิ่ม QueryBoundary ใน `ReportsPage` | `apps/web/src/pages/ReportsPage.tsx` | S | Low |
| 1.11 | เพิ่ม QueryBoundary ใน `PDPAPage` | `apps/web/src/pages/PDPAPage.tsx` | S | Low |
| 1.12 | เพิ่ม QueryBoundary ใน `SystemStatusPage` | `apps/web/src/pages/SystemStatusPage.tsx` | S | Low |
| 1.13 | เพิ่ม QueryBoundary ใน `MigrationPage` | `apps/web/src/pages/MigrationPage.tsx` | S | Low |
| 1.14 | เพิ่ม QueryBoundary ใน `ProductCreatePage` | `apps/web/src/pages/ProductCreatePage.tsx` | S | Low |
| 1.15 | a11y: แทน `<div onClick>` (6 จุด) ใน OverduePage ด้วย `<button>` หรือเพิ่ม `role="button"` + keyboard handlers | `apps/web/src/pages/OverduePage.tsx` | S | Low |
| 1.16 | a11y: แทน `<div onClick>` (2 จุด) ใน StockTransfersPage | `apps/web/src/pages/StockTransfersPage.tsx` | S | Low |
| 1.17 | a11y: แทน `<div onClick>` ใน ExpensesPage + FinanceReceivablePage (1+1) | `apps/web/src/pages/ExpensesPage.tsx`, `apps/web/src/pages/FinanceReceivablePage.tsx` | S | Low |
| 1.18 | Document intentional public endpoints ใน `.claude/rules/security.md` — chatbot-finance-liff, sms-webhook (เพื่อไม่ให้ future audit flag ผิดว่า missing guard) | `.claude/rules/security.md` | S | Low |

**Effort รวม**: S-M (~1 สัปดาห์)
**Rationale**: ทุกอันแก้เล็ก ๆ แต่ลด silent failures + ยกเครื่อง consistency ให้ทั้ง codebase match rules

---

## Phase 2 — Decimal Precision + Accounting Test Coverage (High value, Medium risk)

**Theme**: เงินหายที่ทศนิยม + เขียน safety net รอบ core accounting

### 2A: Decimal Precision Cleanup

Replace `Number(aggregate._sum.field || 0)` → `Prisma.Decimal` arithmetic, เหมือน pattern ที่ v2 ใช้กับ commission/repossessions

| # | Task | File | Occurrences | Effort |
|---|------|------|-------------|--------|
| 2.1 | accounting.service.ts — Balance Sheet `Number()` → Decimal | `apps/api/src/modules/accounting/accounting.service.ts:898-905,961-966,975-977` | ~12 | M |
| 2.2 | accounting.service.ts — Cash Flow Statement `Number()` → Decimal | `apps/api/src/modules/accounting/accounting.service.ts:1082-1092` | ~8 | M |
| 2.3 | accounting.service.ts — P&L `Number()` → Decimal (remaining) | `apps/api/src/modules/accounting/accounting.service.ts` (remaining of 24) | ~4 | S |
| 2.4 | reports.service.ts — 6 จุด | `apps/api/src/modules/reports/reports.service.ts` | 6 | M |
| 2.5 | sales.service.ts — 5 จุด | `apps/api/src/modules/sales/sales.service.ts` | 5 | S |
| 2.6 | dashboard.service.ts — 4 จุด | `apps/api/src/modules/dashboard/dashboard.service.ts` | 4 | S |
| 2.7 | overdue.service.ts — 3 จุด | `apps/api/src/modules/overdue/overdue.service.ts` | 3 | S |
| 2.8 | repossessions.service.ts — 3 จุด | `apps/api/src/modules/repossessions/repossessions.service.ts` | 3 | S |
| 2.9 | payments.service.ts — 2 จุด | `apps/api/src/modules/payments/payments.service.ts` | 2 | S |
| 2.10 | contracts.service.ts + report-generator + admin-analytics — 3 จุด | multiple | 3 | S |

**Sub-total**: 50 fixes, ~M (1 สัปดาห์)

### 2B: Spec Coverage for Highest-Risk Services

| # | Task | Target | Coverage | Effort |
|---|------|--------|----------|--------|
| 2.11 | **accounting.service.spec.ts** (NEW) — P&L, Balance Sheet, Cash Flow, MoM/YoY comparison, period close guard, validatePeriodOpen | `apps/api/src/modules/accounting/accounting.service.ts` (1115 lines) | ~40 tests | L |
| 2.12 | **payments.service.spec.ts** (NEW) — payment recording, partial/overpayment, late fee calc, principal/interest split, credit balance | `apps/api/src/modules/payments/payments.service.ts` (799 lines) | ~25 tests | L |
| 2.13 | **contracts.service.spec.ts** (NEW) — contract creation, status transitions, early payoff calc | `apps/api/src/modules/contracts/contracts.service.ts` (584 lines) | ~20 tests | M |
| 2.14 | **repossessions.service.spec.ts** (NEW) — repo workflow, refurbish cost tracking, resale P/L | `apps/api/src/modules/repossessions/repossessions.service.ts` | ~15 tests | M |
| 2.15 | **trade-in.service.spec.ts** (NEW) — deferred จาก v3, valuation table + buy-in flow | `apps/api/src/modules/trade-in/trade-in.service.ts` | ~15 tests | M |
| 2.16 | **sales.service.spec.ts** (NEW) — CASH/INSTALLMENT/EXTERNAL_FINANCE flows, down payment, refund | `apps/api/src/modules/sales/sales.service.ts` | ~20 tests | M |

**Target**: +135 tests → API total ~535 tests (21 → 27 suites)

**Effort รวม Phase 2**: L (2-3 สัปดาห์)
**Risk**: Medium — Decimal refactor ต้องระวัง regression ใน report output; spec เขียนใหม่ต้องเข้าใจ business rules

**Rationale**: accounting.service.ts มี comment อธิบายไว้ว่า Balance Sheet derived from data "is always balanced by definition, when GL is implemented should verify independently" — นั่นคือระบบรู้ตัวว่ายังเสี่ยง → ต้องมี spec มาดักไว้ก่อนที่จะ trust report output กับลูกค้า/นักบัญชี

---

## Phase 3 — DevOps, Retention, Refactoring (Medium value, Medium-High risk)

**Theme**: ความพร้อม production ระยะยาว + ลด technical debt

### 3A: Retention & Backup

| # | Task | Effort | Risk |
|---|------|--------|------|
| 3.1 | **ChatMessage retention cron** (deferred v3) — auto-archive chat messages > 6 months | M | Low |
| 3.2 | **DocumentAuditLog retention cron** (deferred v3) — 2-year retention + archive | M | Low |
| 3.3 | **Off-site backup replication** — Cloud SQL backup → GCS bucket (cross-region), documented runbook | M | Med |
| 3.4 | Backup restoration drill script — test restore ไปยัง staging DB เพื่อ verify backup integrity | S | Low |

### 3B: Observability

| # | Task | File(s) | Effort | Risk |
|---|------|---------|--------|------|
| 3.5 | Structured logging utility — wrap Logger.log() → JSON with correlation ID, user ID, request ID | `apps/api/src/common/logger/` (new) | M | Med |
| 3.6 | Apply structured logger ใน top 5 services: accounting, payments, contracts, finance-receivable, dashboard | multiple | M | Low |
| 3.7 | Request-level tracing — attach `x-request-id` header on API responses, include in Sentry tags | `apps/api/src/main.ts` | S | Low |
| 3.8 | **Health check endpoint** `/health` with DB + Redis + S3 probes (for GCP Cloud Run liveness) | `apps/api/src/modules/health/` (new tiny module) | S | Low |

### 3C: Refactoring Debt (optional, time-permitting)

| # | Task | Current size | Split into | Effort | Risk |
|---|------|--------------|------------|--------|------|
| 3.9 | Split `documents.service.ts` (1483 lines) → generation / signature / storage | `apps/api/src/modules/contracts/documents.service.ts` | 3 services | L | High |
| 3.10 | Split `line-oa.controller.ts` (1029 lines, flagged CR-CQ-001) → webhook / menu / message | `apps/api/src/modules/line-oa/line-oa.controller.ts` | 3 controllers | L | High |
| 3.11 | Split `CreditChecksPage.tsx` (1382 lines) → form / list / detail components | `apps/web/src/pages/CreditChecksPage.tsx` | sub-components | M | Med |

**Recommendation**: ทำ 3A + 3B ก่อน ส่วน 3C ทำต่อเมื่อมีเวลาเหลือ (refactor ใหญ่เสี่ยง regression, อาจแยก PR)

**Effort รวม Phase 3**: M-L (1-2 สัปดาห์ สำหรับ 3A+3B, +1-2 สัปดาห์ ถ้ารวม 3C)

---

## Out of Scope for v4

สิ่งเหล่านี้ **พิจารณาแล้วตัดออก** จาก v4 พร้อมเหตุผล:

| # | Item | เหตุผลที่ข้าม |
|---|------|-------------|
| 1 | VAT-on-interest policy (CR-001) | ต้องรอ business decision จากเจ้าของ + นักบัญชี — ไม่ใช่งาน engineering |
| 2 | GFIN integration | รอ API spec จาก partner ภายนอก |
| 3 | General Ledger refactor (แทน derived Balance Sheet) | Scope ใหญ่มาก — ต้องเป็น dedicated sprint แยก + business review |
| 4 | PII column-level encryption (PDPA strict mode) | ต้องตัดสินใจ key management strategy (KMS?) + migration ใหญ่ |
| 5 | CHATCONE unified chat integration | Feature ใหม่ ไม่ใช่ hardening |
| 6 | MDM PJ-Soft lock integration | ต้อง credentials + API spec |
| 7 | PEAK accounting sync | ต้อง credentials + API spec + mapping config |
| 8 | UI redesign ด้วย Metronic | อยู่ใน Phase 8 ของ master plan, ทำหลังสุด |
| 9 | E2E role-access expansion ครบทุก role | 33 specs พอสำหรับ smoke; การ expand เป็นงานต่อเนื่อง ไม่ block v4 |
| 10 | Native app / PWA | Q4 2026 decision |

---

## Critical Findings (Fix Now, Not in Sprint)

จาก audit ทั่วไปไม่พบปัญหาที่ต้องแก้**ด่วนก่อน sprint** — ดีมาก:
- TypeScript 0 errors ✓
- 400 API tests + 129 web tests ทั้งหมดผ่าน ✓
- ไม่มี empty catch blocks ใน services ✓
- ไม่มี hardcoded secrets ใน src/ ✓
- ไม่มี `console.log` ใน services (ยกเว้น 1 จุดใน auth.service.ts)
- ไม่มี `useEffect + fetch` anti-pattern ใน frontend ✓

**แต่** การเจาะลึกเฉพาะ **ระบบบัญชี** (ดู Phase 4 ด้านล่าง) พบ **2 bugs เงียบที่อาจทำให้บัญชีผิด** — ต้องแก้ **ก่อน** ใช้กับข้อมูลจริงจากลูกค้า (ดู N-002, N-003)

**Conclusion**: Codebase ทั่วไปมี sanitation level สูง — แต่ส่วนบัญชีมีจุดเงียบ 2-3 จุดที่ควรเป็น Phase 4 ของ v4

---

## Phase 4 — Accounting Correctness (NEW — High value, High risk)

**Theme**: ปิดช่องโหว่เงียบในระบบบัญชีหลังตรวจสอบ 8 Critical + 16 Warning จาก audit 2026-04-05 ว่าแก้ไปแค่ไหนและยังเหลืออะไร

### 4.0 สถานะ Critical จาก audit 2026-04-05 (verified 2026-04-09)

| # | Item | สถานะ |
|---|------|------|
| C-001 ผังบัญชี 5 หมวด | `ChartOfAccount` model + PEAK mapping | ✅ FIXED |
| **C-002 VAT on interest** | `installment.util.ts:55` ยังใช้ `(principal + commission + interest) * vatPct` | ❌ **OPEN** — deferred by owner, pending policy decision |
| C-003 WHT fields | `whtRate`, `whtIncomeType`, `payeeTaxId` on Expense | ✅ FIXED |
| C-004 Bad debt provision | `BadDebtProvision` model + service + 22 tests (v3) | ✅ Partial — **journal entry ยังไม่สร้าง** (ดู N-003) |
| C-005 ใบเสร็จครบ | `payerAddress`, `payerTaxId`, `amountBeforeVat`, `vatAmount`, `itemDescription`, void approval | ✅ FIXED |
| C-006 Bundle COGS | `accounting.service.ts:561-578` รวม bundle cost แล้ว | ✅ FIXED |
| C-007 Expense void trail | `voidReason`, `voidedById`, `voidedAt` + `createdById !== approvedById` check | ✅ FIXED |
| C-008 Balance Sheet + Cash Flow | `getBalanceSheet`, `getCashFlowStatement` exist | ✅ FIXED |

**สรุป Critical**: 6/8 ✅ fixed, 1 deferred policy (C-002), 1 partial (C-004 ขาด journal)

### 4.1 สถานะ Warnings (highlights)

| # | Item | สถานะ |
|---|------|------|
| W-005 Voided receipt ยังปรากฏใน queries | `isVoided: false` in where clauses | ✅ FIXED |
| W-007 Inventory journal per sale | `createContractActivationJournal` บันทึก Dr. COGS / Cr. Inventory | ✅ FIXED |
| W-008 Creator = Approver | `approveExpense` validates SoD | ✅ FIXED |
| W-011 AuditLog updatedAt | AuditLog now has only `createdAt` (immutable) | ✅ FIXED |
| W-012 MoM/YoY comparison | `getComparativePL` exists | ✅ FIXED |
| W-013 Period Closing lock | `validatePeriodOpen`, `closeAccountingPeriod` exist | ✅ FIXED |
| W-002 Straight-line vs effective interest | ยังใช้ straight-line, ไม่มี policy doc | ⚠️ **Still needs doc** (R-001) |
| W-003 Gross − unearned interest = Net | ไม่มี `unearnedInterest` field | ❌ OPEN |
| W-009 Inter-company single-entry | ยังใช้ single `InterCompanyTransaction` record | ❌ OPEN (or document ว่า accept ได้) |
| W-006 Credit Note 30-day limit | ยังไม่ verified | ❓ Need to verify |

**สรุป Warnings**: ประมาณ 12/16 ✅ fixed, 4 ยังต้องการการตรวจหรือตัดสินใจ

### 4.2 NEW findings จาก audit pass 2026-04-09 (ยังไม่อยู่ใน report เดิม)

#### [N-001] Journal Auto Service ใช้ `Number()` กับ `Prisma.Decimal` ทุกจุด
- **ไฟล์**: `apps/api/src/modules/journal/journal-auto.service.ts:161-166, 276-282, 402-403`
- **ปัญหา**: ทุก `createPaymentJournal`, `createExpenseJournal`, `createContractActivationJournal`, และ aggregation ของ trial balance ใช้ `Number(decimal)` แปลงก่อนคำนวณ Dr/Cr
- **ความเสี่ยง**: precision loss ที่ satang ทำให้ Dr ≠ Cr (ถ้าต่างเกิน 0.001 → ตก check และ **skip journal เงียบ** — ดู N-002)
- **แก้**: ใช้ `Prisma.Decimal` arithmetic ทั้ง chain (รวมอยู่ใน Phase 2.1-2.3 Decimal cleanup)

#### [N-002] **Silent skip of unbalanced journals** — ⚠️ Critical silent bug
- **ไฟล์**: `apps/api/src/modules/journal/journal-auto.service.ts:89-94`
- **ปัญหา**: ถ้า Dr ≠ Cr จะ `logger.warn()` + `return null` → **ไม่ throw**
- **ผลลัพธ์**:
  - Contract activation, payment, expense เสร็จสำเร็จ (transaction commit)
  - **แต่ journal entry ไม่ถูกสร้าง**
  - P&L, Balance Sheet, Trial Balance ขาดข้อมูลบาง transactions → งบไม่ตรง
  - ไม่มี Sentry alert → ไม่มีใครรู้ว่าหาย
- **แก้**:
  1. `throw new InternalServerErrorException('Journal unbalanced')` แทน return null, หรือ
  2. อย่างน้อย `Sentry.captureException(new Error('Journal unbalanced'), { extra: { ... } })` ก่อน return null
  3. เพิ่ม test ที่สร้าง unbalanced entry → assert throw/sentry
- **Effort**: S | **Risk**: Low | **Priority**: **P0 — ซ่อนในระบบตั้งแต่ journal module เริ่มทำ**

#### [N-003] `writeOffBadDebt` ไม่สร้าง journal entry
- **ไฟล์**: `apps/api/src/modules/accounting/bad-debt.service.ts:211-251`
- **ปัญหา**:
  - ตัดหนี้สูญแล้ว: contract status = `CLOSED_BAD_DEBT` + provision status = `WRITTEN_OFF`
  - **ไม่มี journal entry**: `Dr. Bad Debt Expense / Cr. HP Receivable` (หรือ Cr. Allowance for Doubtful)
  - ผลลัพธ์: Balance Sheet ยังแสดง HP Receivable ค้างอยู่หลังตัดหนี้สูญ → overstate receivable
- **แก้**: เพิ่ม `await journalAutoService.createBadDebtWriteOffJournal(tx, {...})` ใน `$transaction` block
- **Effort**: M (ต้องสร้าง service method ใหม่ + test) | **Risk**: Med | **Priority**: P1

#### [N-004] Bundle COGS ใช้ `Number(costPrice)` — precision ignored
- **ไฟล์**: `apps/api/src/modules/accounting/accounting.service.ts:575`
- **ปัญหา**: `bundleProducts.reduce((sum, p) => sum + Number(p.costPrice || 0), 0)` — แม้จะรวม bundle cost ถูก (C-006 fixed) แต่ precision loss ยังเกิด
- **แก้**: ใช้ `Prisma.Decimal` arithmetic (รวมอยู่ใน Phase 2.1-2.3)

#### [N-005] Interest recognized **upfront** at contract activation (accrual vs cash basis mismatch)
- **ไฟล์**: `apps/api/src/modules/journal/journal-auto.service.ts:130-134,300-306`
- **ปัญหา**:
  - Contract activation journal บันทึก `Cr. Revenue = sellingPrice + interest + commission` **ทั้งก้อน**
  - Comment: "monthlyInterest is treated as part of HP receivable settlement under cash basis — already booked when contract was activated"
  - หมายความว่ารายได้ดอกเบี้ยรับรู้ **ณ วันเปิดสัญญา** ไม่ใช่รับรู้ตามงวด
- **มาตรฐานที่ขัด**:
  - TFRS for NPAEs: hire-purchase interest ควรรับรู้ **ตามอายุสัญญา** (ไม่ใช่ upfront)
  - ไม่ตรงกับ W-002 ที่ระบุใช้ straight-line method
- **ผลกระทบ**:
  - P&L เดือนที่มีสัญญาเปิดเยอะ → กำไรพุ่ง
  - เดือนต่อมา (ช่วงที่ลูกค้าผ่อน) → ไม่มีรายได้ดอกเบี้ยเข้าอีกเลย
  - สำหรับกิจการ installment เป็นเรื่องสำคัญ
- **แก้** (ต้องปรึกษานักบัญชีก่อน):
  1. เปลี่ยนเป็น **straight-line recognition** ตาม W-002 — Dr. HP Receivable (full) / Cr. Revenue (principal+commission only) + Cr. Unearned Interest (interest)
  2. ทุกเดือนเมื่อจ่ายงวด: Dr. Unearned Interest / Cr. Interest Income (ตาม monthlyInterest)
- **Effort**: L (ต้อง refactor journal flow + migration สำหรับ unearnedInterest field) | **Risk**: High | **Priority**: **ต้อง business review ก่อน — น่าจะ out-of-scope v4**

#### [N-006] "Late fees NOT charged VAT" เป็น policy แต่ไม่มี test
- **ไฟล์**: `apps/api/src/modules/journal/journal-auto.service.ts:133`
- **Note**: นี่เป็น policy decision ของเจ้าของ (ถูกต้องตามกฎหมาย — late fee ไม่อยู่ในฐาน VAT)
- **แก้**: เพิ่ม test case ใน `accounting.service.spec.ts` ที่ assert ว่า late fee → not in VAT Output → ป้องกัน regression

### 4.3 Phase 4 Tasks

| # | Task | File | Effort | Risk | Priority |
|---|------|------|--------|------|:--------:|
| 4.1 | **[N-002]** Fix silent skip of unbalanced journals → `throw` + Sentry capture | `apps/api/src/modules/journal/journal-auto.service.ts:89-94` | S | Low | **P0** |
| 4.2 | Test case: unbalanced journal → expect throw + Sentry call | `apps/api/src/modules/journal/journal-auto.service.spec.ts` (NEW) | S | Low | P0 |
| 4.3 | **[N-003]** เพิ่ม `createBadDebtWriteOffJournal` → Dr. Bad Debt Expense / Cr. HP Receivable | `journal-auto.service.ts` + `bad-debt.service.ts:229` | M | Med | P1 |
| 4.4 | Test: writeOffBadDebt → journal entry posted + balanced | `bad-debt.service.spec.ts` (extend existing) | S | Low | P1 |
| 4.5 | **[N-001+N-004]** Decimal arithmetic ใน journal-auto.service.ts ทุก method | `journal-auto.service.ts:161-166,276-282,402-403` | M | Low | P1 |
| 4.6 | **[N-006]** Regression test: late fee → not in VAT Output account | `accounting.service.spec.ts` หรือ `journal-auto.service.spec.ts` | S | Low | P2 |
| 4.7 | **[W-002 + R-001]** Document policy: straight-line interest recognition ใน `.claude/rules/accounting.md` (NEW) | `.claude/rules/accounting.md` | S | Low | P2 |
| 4.8 | **[W-003]** พิจารณาเพิ่ม `unearnedInterest` field ใน Contract + แสดงใน Balance Sheet | `schema.prisma` + `accounting.service.ts:908-971` | M | Med | P2 |
| 4.9 | **[W-006]** Credit Note 30-day limit validation ใน `receipts.service.ts:339-365` | `receipts.service.ts` | S | Low | P2 |
| 4.10 | **[W-009]** Document Inter-Company single-entry rationale (หรือเปลี่ยนเป็น double entry) | `.claude/rules/accounting.md` หรือ refactor | M | Med | P2 |
| 4.11 | **Accounting spec: journal-auto.service.spec.ts (NEW)** — test ทุก create*Journal method: balance verification, company resolution, edge cases | `apps/api/src/modules/journal/journal-auto.service.spec.ts` | L | Low | P1 |
| 4.12 | **Trial Balance test** — สร้าง contract+payment+expense+bad-debt → verify trial balance balanced ทั้งระบบ | `journal-auto.service.spec.ts` integration test | M | Low | P1 |

**Effort รวม Phase 4**: M-L (~1-2 สัปดาห์)
**Risk**: Medium — journal refactor ต้องระวัง backward compatibility; `unearnedInterest` refactor เสี่ยงสูง (แยก PR)

### 4.4 Out of scope จาก Phase 4 (ต้อง business review)

| # | Item | เหตุผล |
|---|------|------|
| C-002 | VAT on interest ยังคงรวมในฐาน | Owner deferred — ต้องปรึกษานักบัญชี + decision |
| N-005 | Interest recognized upfront (แทน accrual ตามงวด) | Accounting policy — ต้อง CPA review + migration ใหญ่ |
| W-014 | 3-way segregation (สร้าง ≠ อนุมัติ ≠ ตรวจ) | Organizational — ไม่ใช่ engineering |
| R-004 | Full bad debt write-off approval chain | Feature — นอกขอบเขต hardening |
| R-009 | Inter-Company transfer pricing documentation | Business policy |

---

## Phase 5 — UX/UI Debt (NEW — Medium value, Low risk)

**Theme**: ปิด UX/UI backlog จาก audit 2026-04-06 — หลัก ๆ คือ **accessibility** และ **form validation** (infrastructure มีครบแล้วแต่ไม่ได้เปิดใช้)

### 5.0 สถานะ UX Critical 5 จาก audit 2026-04-06 (verified 2026-04-09)

| # | Item | สถานะ | หลักฐาน |
|---|------|------|--------|
| **UX-C001** ไม่ใช้ Breadcrumb ในหน้า detail | ❌ **OPEN** — `components/ui/breadcrumb.tsx` ยัง import ใช้ **0 pages** | grep Breadcrumb in pages → 0 |
| **UX-C002** ไม่มี inline form validation | ❌ **OPEN** — react-hook-form + zod + @hookform/resolvers + lib/schemas.ts ติดตั้ง **แต่ 0 pages ใช้ `useForm`** | grep useForm → เฉพาะใน `lib/schemas.ts` doc comment |
| **UX-C003** ไม่มี auto-save ใน ContractCreatePage | ❌ **OPEN** | grep localStorage+draft/autosave → 0 |
| **UX-C004** Alt text ว่าง (5 จุด) | ⚠️ **Partial** — ลดจาก 5 → **6 จุด** (เพิ่มจาก LiffFinanceVerify แทน): UsersPage × 2, StockTransfersPage × 1, LiffRegister × 1, LiffFinanceVerify × 1, DocumentUploadStep × 1 | grep `alt=""` |
| **UX-C005** ไม่มี copy-to-clipboard | ⚠️ **Partial** — ContractDetailPage มี copy customer link แล้ว, UsersPage มี, LineOaSettingsPage มี **แต่ PaymentTable + POS + IMEI/contract number ยังไม่มี** | grep navigator.clipboard |

**สรุป Critical**: 0/5 fully fixed — 2 partial, 3 ยังเต็ม ๆ

### 5.1 สถานะ UX Warnings (highlights)

| # | Item | สถานะ |
|---|------|------|
| UX-W001 Dynamic browser tab titles | ❌ OPEN — 0 pages ใช้ `document.title` / Helmet / useDocumentTitle |
| UX-W002 Hardcoded colors in index.css | ❌ OPEN — ยังมี 10 hex codes ที่ `index.css:146,177,188,195,202,216,219,229,230,242` |
| UX-W003 POS Flow ยาว | ❌ OPEN — POSPage.tsx 797 lines, ยัง 6 sections |
| **UX-W004** YoY/MoM comparison on KPI cards | ⚠️ Partial — **API มี `getComparativePL` แล้ว** (ultraplan v3 W-012) **แต่ frontend ยังไม่ consume** |
| UX-W005 PDF/Excel export for P&L | ❌ OPEN — 5 pages ใช้ exceljs/jspdf แต่ไม่รวม ProfitLossPage / FinancialAuditPage / FinanceReceivablePage |
| UX-W006 Optimistic updates | ❌ OPEN — มีเฉพาะ `TodosPage.tsx` ที่ใช้ `onMutate` (1 ใน ~60 pages) |
| UX-W007 Heading hierarchy | ⚠️ Partial — CustomersPage ใช้ h2→h3→h4 ถูก, POSPage ใช้ PageHeader (h1) แต่ body ไม่มี h2/h3 tags |
| UX-W008 Form label htmlFor | ❌ OPEN — `htmlFor=` ปรากฏเฉพาะ 4 pages (Login, Register, Forgot, Reset) จาก ~40 form pages |
| UX-W009 `<section>` semantic wrappers | ❌ OPEN — `<section>` ปรากฏเฉพาะ LandingPage (5) + ChatbotFinanceAnalyticsPage (4) จาก ~60 pages |

**สรุป Warnings**: 0/9 fully fixed, 2 partial (W-004, W-007), 7 ยังเต็ม ๆ

### 5.2 New UX findings จาก audit pass 2026-04-09

#### [UX-N001] ไม่มี `<SkipLink>` (skip-to-main-content) — WCAG 2.1 A
- **ปัญหา**: Keyboard/screen-reader users ต้อง Tab ผ่านทุก menu item ทุกครั้งที่เปลี่ยนหน้า
- **แก้**: เพิ่ม `<a href="#main" className="sr-only focus:not-sr-only">ข้ามไปเนื้อหาหลัก</a>` ใน MainLayout + `<main id="main">`

#### [UX-N002] ไม่มี `@media (prefers-reduced-motion)` handling
- **ปัญหา**: มี animation ทั่วระบบ (skeleton, transitions, AnimatedCounter) แต่ไม่ respect OS setting
- **แก้**: เพิ่ม CSS `@media (prefers-reduced-motion: reduce) { animation: none; transition: none; }` ใน index.css

#### [UX-N003] Form inputs ส่วนใหญ่ไม่มี `autoComplete` attribute
- **ปัญหา**: Browser autofill ใช้งานไม่ได้ — เฉพาะ 2 LIFF pages มี (จาก ~34 form pages)
- **ผลกระทบ**: พนักงานต้องพิมพ์ชื่อ/ที่อยู่/เบอร์โทรซ้ำ ๆ ทุกครั้งที่สร้างลูกค้าใหม่
- **แก้**: เพิ่ม `autoComplete="tel"` / `"email"` / `"name"` / `"postal-code"` / `"off"` (สำหรับ OTP) ในทุก form input

#### [UX-N004] มี infra พร้อมแต่ **ไม่ migrate** forms ไปใช้ react-hook-form + zod
- **ไฟล์**: `apps/web/src/lib/schemas.ts`, `apps/web/src/components/ui/form.tsx`
- **ปัญหา**: Form component wrapper + zodResolver + schemas พร้อมใช้ แต่ **ไม่มี page ไหน adopt** → UX-C002 ไม่แก้ + effort ใหญ่ขึ้นทุกวัน
- **แก้**: Migrate **3 forms สำคัญที่สุดก่อน** เป็น reference: POSPage (Sale form), ContractCreatePage (PlanDetailsStep), CustomersPage (Create/Edit customer)

#### [UX-N005] Consistency check — navigator.clipboard ใช้ inline 4 จุด (ไม่มี hook)
- **ปัญหา**: ซ้ำ code pattern — ควรมี `useCopyToClipboard` hook ใน `hooks/`
- **แก้**: สร้าง `apps/web/src/hooks/useCopyToClipboard.ts` → `{ copy, copied, error }` + replace 4 call sites + ใช้สำหรับ UX-C005 (contract number, IMEI, phone)

#### [UX-N006] 6 `alt=""` จุด (เพิ่มจาก report 2026-04-06 ที่บอก 5 จุด)
- `StockTransfersPage.tsx:729`, `UsersPage.tsx:302,640`, `LiffRegister.tsx:183`, `LiffFinanceVerify.tsx:209` (ใหม่), `DocumentUploadStep.tsx:65`
- Note: LiffFinanceVerify เป็น page ใหม่ที่เพิ่มเข้ามาหลัง 2026-04-06 → แสดงว่าไม่มี lint rule กัน ซึ่งเป็นเหตุให้ issue นี้กลับมาเรื่อย ๆ
- **แก้ root cause**: เพิ่ม ESLint rule `jsx-a11y/alt-text` หรือ `@typescript-eslint/no-empty-strings` เพื่อ lint `alt=""`

### 5.3 Phase 5 Tasks

#### 5A: Quick A11y wins (Week 1)

| # | Task | File(s) | Effort | Priority |
|---|------|---------|--------|:--------:|
| 5.1 | แก้ `alt=""` ทุกจุด (6 files) ให้ใส่ meaningful alt | UsersPage, StockTransfersPage, LiffRegister, LiffFinanceVerify, DocumentUploadStep × 6 locations | S | **P0** |
| 5.2 | เพิ่ม ESLint rule `jsx-a11y/alt-text` เป็น error (กัน regression) | `apps/web/.eslintrc.cjs` หรือ `eslint.config.js` | S | P0 |
| 5.3 | สร้าง `<SkipLink>` component + wire เข้า `MainLayout.tsx` + `<main id="main">` | `apps/web/src/components/layout/MainLayout.tsx`, `SkipLink.tsx` (new) | S | P1 |
| 5.4 | เพิ่ม `@media (prefers-reduced-motion: reduce)` ใน index.css | `apps/web/src/index.css` | S | P1 |
| 5.5 | สร้าง `useCopyToClipboard` hook + migrate 4 existing call sites | `apps/web/src/hooks/useCopyToClipboard.ts` (new) | S | P1 |
| 5.6 | เพิ่ม copy button ข้างเลขสัญญาใน `ContractDetailPage` + `PaymentTable` + `POSPage` (IMEI + phone) | 3 pages | S | P1 |
| 5.7 | **[UX-C001]** Wire Breadcrumb เข้า 5 หน้า detail: Contract, Customer, Product, Supplier, Inspection | 5 detail pages + `PageHeader.tsx` | M | P1 |

#### 5B: Form modernization (Week 2-3)

| # | Task | File(s) | Effort | Priority |
|---|------|---------|--------|:--------:|
| 5.8 | **[UX-C002 reference 1]** Migrate `POSPage` sale form → `react-hook-form` + zodResolver + inline errors | `apps/web/src/pages/POSPage.tsx` | M | P1 |
| 5.9 | **[UX-C002 reference 2]** Migrate `PlanDetailsStep` ใน ContractCreate → react-hook-form + zod | `apps/web/src/pages/ContractCreatePage/components/PlanDetailsStep.tsx` | M | P1 |
| 5.10 | **[UX-C002 reference 3]** Migrate `CustomersPage` create/edit modal → react-hook-form + zod (schema มีอยู่แล้วใน `lib/schemas.ts`) | `apps/web/src/pages/CustomersPage.tsx` | M | P1 |
| 5.11 | **[UX-C003]** Auto-save draft ใน ContractCreatePage (localStorage, 30s interval) + "กู้คืนข้อมูล?" prompt | `apps/web/src/pages/ContractCreatePage/index.tsx` + `useDraftStorage` hook (new) | M | P1 |
| 5.12 | Document form migration guide ใน `.claude/rules/frontend.md` (react-hook-form + zod pattern) | `.claude/rules/frontend.md` | S | P2 |
| 5.13 | Migrate PaymentModals, BranchesPage, UsersPage create/edit forms (incremental) | 3 pages | M | P2 |

#### 5C: Accessibility sweep (Week 3)

| # | Task | File(s) | Effort | Priority |
|---|------|---------|--------|:--------:|
| 5.14 | **[UX-W008]** Add `htmlFor=` / `id=` associations ใน 30+ form pages (ตาม pattern ของ react-hook-form wrapper) | ทุก form page | M | P1 |
| 5.15 | **[UX-W009]** Wrap content regions ใน `<section aria-labelledby="...">` สำหรับ top 10 pages | Top pages with multiple regions | M | P2 |
| 5.16 | **[UX-N003]** Add `autoComplete` attribute ใน CustomersPage (name, tel, email, postal-code, bday) + UsersPage + expense forms | `CustomersPage`, `UsersPage`, `ExpensesPage` ฯลฯ | S | P2 |
| 5.17 | Run `axe-core` or `@axe-core/react` automated audit + fix top violations (target ≥ 95/100 lighthouse a11y) | Whole app | M | P2 |
| 5.18 | Add `@axe-core/playwright` scan ใน 5 most-critical E2E tests (login, POS, contract-create, payment, dashboard) | `apps/web/e2e/*.spec.ts` | M | P2 |

#### 5D: Medium UX improvements (Week 4)

| # | Task | File(s) | Effort | Priority |
|---|------|---------|--------|:--------:|
| 5.19 | **[UX-W001]** Dynamic tab titles via `useDocumentTitle` hook (20 important pages) | `hooks/useDocumentTitle.ts` (new) + 20 pages | M | P2 |
| 5.20 | **[UX-W002]** แทน 10 hardcoded hex colors ใน `index.css` → CSS variables | `apps/web/src/index.css:146,177,188,...` | S | P2 |
| 5.21 | **[UX-W004]** Wire frontend ของ DashboardKPIs + ProfitLossPage เข้า `getComparativePL` API → แสดง badge "↑12% vs เดือนก่อน" | `DashboardKPIs.tsx`, `ProfitLossPage.tsx`, `api.ts` | M | P2 |
| 5.22 | **[UX-W005]** PDF export สำหรับ ProfitLossPage (ใช้ jspdf ที่มีอยู่แล้วใน bundle chunk) | `ProfitLossPage.tsx` | M | P2 |
| 5.23 | **[UX-W005]** Excel export สำหรับ FinanceReceivablePage (ใช้ exceljs) | `FinanceReceivablePage.tsx` | S | P2 |
| 5.24 | **[UX-W006]** Optimistic update pattern ใน PaymentsPage (delete, void) + CustomersPage (delete) | 2 pages | M | P3 |
| 5.25 | **[UX-W007]** Audit + fix heading hierarchy ใน POSPage (เพิ่ม h2 ก่อน section labels) | `POSPage.tsx` | S | P3 |

**Effort รวม Phase 5**: L (~3-4 สัปดาห์)
**Risk**: Low-Med — form migration เสี่ยงต้องการ regression testing แต่ไม่กระทบ business logic

### 5.4 Out of scope จาก Phase 5

| # | Item | เหตุผล |
|---|------|------|
| UX-W003 POS flow redesign | ต้อง UX research + business review — อย่า redesign ก่อน user testing |
| UX-S001 Form keyboard shortcuts | Nice-to-have — รอทดสอบ base form migration ก่อน |
| UX-S003 Accordion calculations | Nice-to-have — UX improvement only |
| UX-S005 YoY chart overlay | ต้อง design review — chart ปัจจุบันใช้งานได้ |
| UX-S007 Sidebar search | Nice-to-have, คน search ผ่าน Ctrl+K อยู่แล้ว |
| Full Metronic redesign | อยู่ใน Phase 8 ของ master plan — ทำหลังสุด |

---

## Success Criteria for v4

- [ ] 0 TypeScript errors
- [ ] API test count ≥ 560 (from 400) ← +160 tests (รวม journal-auto + trial balance)
- [ ] Web test count ≥ 135 (from 129) ← incremental
- [ ] 0 `Number()` on Prisma Decimal aggregates ใน `apps/api/src/modules/**/*.service.ts`
- [ ] 0 `confirm()` / `alert()` ใน `apps/web/src/pages/`
- [ ] 100% Cron jobs มี Sentry capture (เพิ่มอีก 5)
- [ ] 100% pages ที่ใช้ `useQuery` มี QueryBoundary (ยกเว้น public/portal ที่ documented)
- [ ] Off-site backup runbook + test restore drill documented
- [ ] `/health` endpoint returning DB + Redis + S3 status
- [ ] Structured logging in top 5 core services
- [ ] **[Accounting] Journal unbalanced → throws + Sentry alert (not silent skip)**
- [ ] **[Accounting] writeOffBadDebt สร้าง journal entry + test coverage**
- [ ] **[Accounting] Trial Balance end-to-end test: contract + payment + expense + write-off → Dr = Cr**
- [ ] **[Accounting] `.claude/rules/accounting.md` documenting straight-line interest policy**
- [ ] **[UX] 0 `alt=""` ใน `apps/web/src/` + ESLint `jsx-a11y/alt-text` enforced**
- [ ] **[UX] 3 reference forms migrated to react-hook-form + zod (POSPage, ContractCreate/PlanDetails, CustomersPage)**
- [ ] **[UX] Breadcrumb wired into 5+ detail pages**
- [ ] **[UX] ContractCreatePage auto-save draft (localStorage + recovery prompt)**
- [ ] **[UX] `useCopyToClipboard` hook + applied to contract number / IMEI / phone in POS + PaymentTable + ContractDetail**
- [ ] **[UX] SkipLink + `prefers-reduced-motion` + Lighthouse a11y ≥ 95**
- [ ] **[UX] Frontend consumes `getComparativePL` → KPI cards แสดง "vs เดือนก่อน"**

---

## Timeline

```
Phase 1 (Silent Bleeders)               │ Week 1           → PR v4.1
Phase 4.1-4.2 (P0: Journal silent skip) │ Week 1 (ด่วน)   │ (merge with v4.1)
Phase 5A (Quick a11y + copy hook)       │ Week 1-2         │ (merge with v4.1)
Phase 2A (Decimal cleanup)              │ Week 2           │
Phase 4.3-4.6 (Bad debt journal, tests) │ Week 2-3         │
Phase 2B (Accounting/payments spec)     │ Week 3-4         │ → PR v4.2
Phase 5B (Form modernization)           │ Week 3-5         │
Phase 4.7-4.12 (Policy, unearned int.)  │ Week 4           │
Phase 5C (A11y sweep)                   │ Week 5           │ → PR v4.3
Phase 3A (Retention + Backup)           │ Week 6           │
Phase 3B (Observability)                │ Week 6-7         │ → PR v4.4
Phase 5D (Medium UX)                    │ Week 6-7         │
Phase 3C (Refactoring, optional)        │ Week 8+          │ → separate PR(s)
```

**IMPORTANT**: Phase 4.1-4.2 (journal unbalanced) + Phase 5A (a11y quick wins) ควรรวมใน **PR v4.1** เพราะเป็น P0 — ช่องโหว่เงียบและ a11y regression ที่มีอยู่ในระบบแล้ว

---

## Reference

- v1-v3 hardening history: `.claude/CLAUDE.md` (Hardening History section)
- Previous master list: `docs/reports/MASTER-PRIORITY-LIST-2026-04-06.md`
- Accounting audit: `docs/reports/ACCOUNTING-AUDIT-REPORT-2026-04-05.md`
- Code review: `docs/reports/CODE-REVIEW-REPORT-2026-04-06.md`

**Next Step**: รอ approval จาก owner → แยกเป็น feature branches (phase 1, 2, 3) → ทำตามลำดับเหมือน v3
