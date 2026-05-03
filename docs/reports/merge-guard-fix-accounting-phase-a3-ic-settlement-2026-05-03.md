# Merge Guard Report — fix/accounting-phase-a3-ic-settlement

**Date**: 2026-05-03  
**Branch**: `fix/accounting-phase-a3-ic-settlement`  
**Diverges from**: `80988a92` (feat: Phase A.2 — Deferred income — on main)  
**Author**: Akenarin Kongdach  
**Reviewed by**: Pre-Merge Guard Agent  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

| File | +/- | Purpose |
|------|-----|---------|
| `apps/api/src/app.module.ts` | +3 | Register `IntercompanyModule` |
| `apps/api/src/modules/intercompany/dto/settle-intercompany.dto.ts` | +20 | New DTO |
| `apps/api/src/modules/intercompany/intercompany.controller.ts` | +29 | New controller |
| `apps/api/src/modules/intercompany/intercompany.module.ts` | +12 | New module |
| `apps/api/src/modules/intercompany/intercompany.service.spec.ts` | +124 | Service tests (4 describe blocks) |
| `apps/api/src/modules/intercompany/intercompany.service.ts` | +103 | New service |
| `apps/api/src/modules/journal/journal-auto.service.spec.ts` | +92 | JE method tests (4 cases) |
| `apps/api/src/modules/journal/journal-auto.service.ts` | +91 | `createInterCompanySettlementJournal` |

**Total**: 474 insertions, 0 deletions across 8 files (pure addition).

---

## What This Branch Does

Implements Phase A.3 (W-5) — the inter-company settlement flow where FINANCE pays SHOP to settle the accumulated `Due-to-SHOP` liability built up from contract activations.

**Endpoint** `GET /accounting/intercompany/balance` — returns `financeOwesToShop`, `shopReceivableFromFinance`, `balanced`, `drift` by aggregating `JournalLine` entries on accounts `11-2105` (SHOP) and `21-1102` (FINANCE).

**Endpoint** `POST /accounting/intercompany/settle` — validates settlement amount ≤ outstanding balance, then posts paired SHOP+FINANCE JEs in a `$transaction`:
- FINANCE: `Dr. Due-to-SHOP (21-1102)` / `Cr. Cash (11-1101)`
- SHOP: `Dr. Cash (11-1101)` / `Cr. Due-from-FINANCE (11-2105)`

Both entries share an `[IC-<uuid>]` description prefix for traceability.

---

## Issues Found

### Critical
None.

### Warning

**W1 — TOCTOU race condition in `settle()`** (`intercompany.service.ts:79–93`)
```typescript
async settle(dto: SettleIntercompanyDto, userId: string) {
  const balance = await this.getOutstandingBalance();   // ← check OUTSIDE tx
  if (dto.amount > balance.financeOwesToShop + 0.01) {
    throw new BadRequestException(...);
  }
  const result = await this.prisma.$transaction(async (tx) => {  // ← use inside tx
    return this.journalAuto.createInterCompanySettlementJournal(tx, { ... });
  });
}
```
`getOutstandingBalance()` runs outside the transaction. Two concurrent settlement requests could both read the same outstanding balance (e.g., ฿10,600), both pass the guard, and together post ฿21,200 against a ฿10,600 balance. The `$transaction` only ensures atomicity per JE — it does NOT re-validate the balance inside the lock.

**Fix**: Move `getOutstandingBalance()` inside the `$transaction` callback, or add a `pg_advisory_xact_lock` (same pattern as W-2 in the companion branch) keyed to the FINANCE company ID.

**W2 — Missing Thai error messages on `@MaxLength` validators** (`settle-intercompany.dto.ts:10,14`)
```typescript
@MaxLength(50)          // no Thai message
reference!: string;

@MaxLength(500)         // no Thai message
notes?: string;
```
Per backend conventions, all DTO validators must include Thai `{ message: '...' }`. Should be:
```typescript
@MaxLength(50, { message: 'เลขที่อ้างอิงต้องไม่เกิน 50 ตัวอักษร' })
@MaxLength(500, { message: 'หมายเหตุต้องไม่เกิน 500 ตัวอักษร' })
```

**W3 — Float comparison on financial value** (`intercompany.service.ts:84`)
```typescript
if (dto.amount > balance.financeOwesToShop + 0.01) {
```
`balance.financeOwesToShop` is a `number` (from `.toNumber()` on `Prisma.Decimal`). Plain float arithmetic. The `+0.01` tolerance is intentional (avoids rejecting exact-balance settlements due to floating-point drift) but the guard logic could over-permit amounts up to `1 satang` above the balance. Acceptable for a business guard check, but document the intent.

### Info

**I1 — Return type could be narrower** (`journal-auto.service.ts` return type)
```typescript
): Promise<{ financeEntryId: string | null; shopEntryId: string | null }>
```
Both `createAndPost` calls inside always return a non-null string or throw. The `| null` in the return type is misleading. Could be `Promise<{ financeEntryId: string; shopEntryId: string }>`.

**I2 — Note on `deletedAt: null`**: The `journalLine.aggregate` queries in `getOutstandingBalance` include `deletedAt: null` — correct per soft-delete conventions. ✅

---

## Security Checklist

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on controller class | ✅ Present |
| `@Roles()` on `GET /balance` | ✅ `OWNER, FINANCE_MANAGER, ACCOUNTANT` |
| `@Roles()` on `POST /settle` | ✅ `OWNER, FINANCE_MANAGER` (restricted — correct) |
| `Number()` on money fields | ✅ None — `Prisma.Decimal` used in `createInterCompanySettlementJournal` |
| `deletedAt: null` in queries | ✅ All `findFirst` and `aggregate` queries include it |
| Hardcoded secrets | ✅ None |
| `$queryRaw` injection | ✅ None in this branch |
| `ValidationPipe({ whitelist: true })` | ✅ Present on controller |
| Module registered in `app.module.ts` | ✅ |

---

## Action Required Before Merge

1. **[MUST]** Fix TOCTOU in `settle()` — move balance check inside `$transaction` or add advisory lock (W1)
2. **[SHOULD]** Add Thai error messages to `@MaxLength` in DTO (W2)
