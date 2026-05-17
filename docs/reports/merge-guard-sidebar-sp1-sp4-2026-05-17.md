# Pre-Merge Guard Report — Sidebar SP1–SP4
**Date**: 2026-05-17  
**Reviewer**: Pre-Merge Guard Agent  
**PRs reviewed**: #995, #996, #997, #998 (all target `main`)

---

## Summary Table

| PR | Branch | Title | Critical | Warning | Info | Verdict |
|----|--------|-------|----------|---------|------|---------|
| [#995](https://github.com/iamnaii/BESTCHOICE/pull/995) | feat/sidebar-sp1 | SP1 — P6 Hybrid 2 Pills + Gear | 0 | 3 | 3 | ⚠️ REVIEW |
| [#996](https://github.com/iamnaii/BESTCHOICE/pull/996) | feat/sidebar-sp2 | SP2 — Accounting Reports Gap | 0 | 2 | 4 | ⚠️ REVIEW |
| [#997](https://github.com/iamnaii/BESTCHOICE/pull/997) | feat/sidebar-sp3 | SP3 — Tax Module Restructure | **2** | 5 | 4 | 🚫 BLOCK |
| [#998](https://github.com/iamnaii/BESTCHOICE/pull/998) | feat/sidebar-sp4 | SP4 — Document Number Config UI | 0 | 2 | 3 | ⚠️ REVIEW |

---

## PR #995 — SP1: Sidebar P6 Hybrid 2 Pills + Gear

**Files changed**: 19 (3,292 insertions, 32 deletions)  
**Author**: iamnaii  
**Verdict**: ⚠️ REVIEW — fix BranchManager zone config before merge

### Critical
None found.  
No new NestJS controllers. No money-field arithmetic. No new Prisma queries.

### Warning

| Location | Issue |
|----------|-------|
| `apps/web/src/config/menu.ts:752` | `BRANCH_MANAGER` declares `zones: ['shop', 'fin']` (pill renders) but has zero `zone: 'fin'` sections. Clicking the ไฟแนนซ์ pill shows a blank sidebar. Either remove `'fin'` from BM zones or add fin-zone sections. |
| `apps/web/src/components/layout/MainLayout.tsx:87-112` | `resolveZoneForPath` not memoized — fires `getSidebarForRole` up to 15 times per navigation. No correctness bug but wasted work on every route change. |
| `apps/web/src/components/ComingSoonPage.tsx:536` | External GitHub link with `ExternalLink` icon is `aria-hidden="true"` — screen-reader users get no indication the link opens a new tab. |

### Info

| Location | Note |
|----------|------|
| `apps/web/src/App.tsx` | 1,271 lines — 166 new placeholder routes pushed it further past threshold. Consider `SpPlaceholderRoutes.tsx`. |
| `apps/web/src/config/menu.ts` | 836 lines — growing. |
| `apps/web/src/components/layout/Sidebar.tsx` | 748 lines — growing. |

---

## PR #996 — SP2: Accounting Reports Gap

**Files changed**: 25 (6,034 insertions, 120 deletions)  
**Author**: iamnaii  
**Verdict**: ⚠️ REVIEW — fix unbounded query before merge

### Critical
None found.  
All new endpoints are on existing guarded controllers. `Prisma.Decimal` used throughout service layer; `.toNumber()` only at JSON response boundary. All new queries have `deletedAt: null`.

### Warning

| Location | Issue |
|----------|-------|
| `apps/api/src/modules/inter-company/inter-company.service.ts:386` | `getAging()` calls `findMany()` with no `take` limit; 500-row cap applied in app memory after full table scan. Move `take: 501` to the Prisma query. |
| `apps/web/src/pages/CashFlowPage.tsx`, `EquityStatementPage.tsx`, `GeneralLedgerPage.tsx` | `fmtAmount` / `fmt()` helper using `toLocaleString('th-TH', …)` defined identically in all three files. Extract to `@/lib/format.ts`. |

### Info

| Location | Note |
|----------|------|
| `apps/api/src/modules/accounting/accounting.service.ts` | Grows to ~1,674 lines after 3 new methods. Consider `AccountingReportsService`. |
| `apps/web/src/pages/IntercompanySettlementPage.tsx` | 634 lines — exceeds 500-line guideline. |
| Multiple test files | `let prisma: any` with `eslint-disable` comments. Use `jest.Mocked<PrismaService>`. |
| `GeneralLedgerPage.tsx` Excel export | `new Date(l.entryDate).toISOString().slice(0, 10)` — use `formatDateMedium` from `@/lib/date` for consistency. |

---

## PR #997 — SP3: Tax Module Restructure

**Files changed**: 26 (5,981 insertions, 584 deletions)  
**Author**: iamnaii  
**Verdict**: 🚫 BLOCK — 2 critical issues must be fixed

### Critical

| Location | Issue |
|----------|-------|
| `apps/api/src/modules/tax/tax.service.ts:327-352` | **`Number()` on `Prisma.Decimal` financial fields** — `Number(s.amount ?? 0)`, `Number(s.vatAmount ?? 0)`, `Number(p.amount ?? 0)`, `Number(p.vatAmount ?? 0)`, `Number(data.totalVatOutput)`, `Number(data.totalVatInput)`, `Number(data.netVat)` inside `exportTaxFormXlsx`. Replace all with `.toNumber()` — project rules prohibit `Number()` on Decimal values absolutely. |
| `apps/api/src/modules/tax/tax.service.ts:372-418` | **`Number()` on `Prisma.Decimal` financial fields** (PND1/PND3/PND53 export sheets) — `Number(it.gross)`, `Number(it.whtAmount)`, `Number(data.grossIncome)`, `Number(data.whtTotal)`, `Number(it.whtPercent)` passed into ExcelJS cells. Replace all with `.toNumber()`. |

**Fix required**: in `tax.service.ts`, replace every `Number(expr)` where `expr` is a `Prisma.Decimal` with `expr.toNumber()`.

### Warning

| Location | Issue |
|----------|-------|
| `apps/web/src/pages/ETaxInvoicePage.tsx:227`, `VatReportPage.tsx:238,282`, `WhtReportPage.tsx:121,165` | `new Date(...).toLocaleDateString('th-TH')` used directly in JSX — use helpers from `@/lib/date` (`formatThaiDateShort` or equivalent). |
| `apps/web/src/pages/ETaxInvoicePage.tsx`, `VatReportPage.tsx:45`, `WhtReportPage.tsx:81` | `fmtNumber` helper with `toLocaleString('th-TH', …)` defined in all 3 files — extract to shared `@/lib/format.ts`. |
| `apps/api/src/modules/e-tax/e-tax.service.ts:215` | `addressIdCard` selected from customer but never used in Phase 1 PDF generation — unnecessary PII fetch. Remove from `select`. |
| `apps/web/src/pages/ETaxInvoicePage.tsx:229` | `customerTaxId` (national ID) shown as plaintext — consider masking per PDPA display rule (`1-XXXX-XXXXX-XX-X`). |
| `apps/web/src/pages/VatReportPage.tsx:40-54` | Year filter label `"ปี (ค.ศ.)"` correct for API, but year in export filename `PP30-2026-05.xlsx` may confuse Thai users expecting พ.ศ. |

### Info

| Location | Note |
|----------|------|
| `apps/api/src/modules/tax/__tests__/tax.service.spec.ts:188,387,492,840`, `e-tax.service.spec.ts:17` | `let prisma: any` with eslint-disable — use `jest.Mocked<PrismaService>`. |
| `apps/api/src/modules/tax/tax.service.ts` | 1,051 lines — consider extracting XLSX export to `TaxExportService`. |
| `apps/api/src/modules/e-tax/e-tax.service.ts` | `addressIdCard` field fetched but unused (dead code). |

---

## PR #998 — SP4: Document Number Config UI

**Files changed**: 22 (4,424 insertions, 137 deletions)  
**Author**: iamnaii  
**Verdict**: ⚠️ REVIEW — fix deletedAt and date formatting before merge

### Critical
None found.  
New `DocConfigController` has `@UseGuards(JwtAuthGuard, RolesGuard)` at class level, all methods have `@Roles(...)`. New DTOs have Thai class-validator messages. No `Number()` on financial fields. No raw SQL.

### Warning

| Location | Issue |
|----------|-------|
| `apps/api/src/modules/settings/doc-config/doc-config.service.ts:927,942,957` | `probeExpenseDocs`, `probeOtherIncomeDocs`, `probeOtherIncomeReceipts` call `findFirst` without `where: { deletedAt: null }`. Soft-deleted docs will still influence sequence counters. Add `deletedAt: null` to each probe query. |
| `apps/web/src/pages/DocumentConfigPage.tsx:~1778` | `new Date(row.updatedAt).toLocaleString('th-TH')` — use `@/lib/date` helper; also displays ค.ศ. year instead of พ.ศ. |

### Info

| Location | Note |
|----------|------|
| `apps/api/src/modules/settings/doc-config/__tests__/doc-config.service.spec.ts:410,411` | `let prisma: any`, `let audit: any` with eslint-disable. |
| `apps/api/src/modules/settings/doc-config/doc-config.service.ts` | `getContractDescription()` is dead code (eslint-disabled) — intentional forward-compat anchor for SP5. Remove when SP5 wires contracts. |
| `apps/web/src/pages/DocumentConfigPage.tsx` | 406 lines — approaching threshold. |

---

## Action Items by Priority

### Must fix before merge (SP3 only — BLOCKED)
1. **SP3** `tax.service.ts`: Replace all `Number(expr)` on Decimal financial fields with `expr.toNumber()` — ~15 occurrences in `exportTaxFormXlsx`, `previewPayrollWHT`, `previewVendorWHT`.

### Should fix before merge (all REVIEW PRs)
2. **SP1**: Remove `'fin'` from `BRANCH_MANAGER.zones` or add fin-zone sidebar sections.
3. **SP2**: Add `take: 501` to `getAging()` `findMany()` in `inter-company.service.ts`.
4. **SP4**: Add `deletedAt: null` to 3 probe queries in `doc-config.service.ts`.
5. **SP3/SP4**: Replace `toLocaleDateString`/`toLocaleString` with `@/lib/date` helpers.
6. **SP3**: Remove unused `addressIdCard` PII fetch in `e-tax.service.ts`.

### Can merge with follow-up ticket
7. SP1/SP2/SP3/SP4: Extract duplicated `fmtAmount`/`fmtNumber` helpers to `@/lib/format.ts`.
8. SP2: Extract `AccountingReportsService` from the growing `accounting.service.ts`.
9. All: Replace `let prisma: any` in test files with `jest.Mocked<PrismaService>`.
