# Merge Guard Report — fix/liff-sync-customer-lineid

**Date**: 2026-04-23  
**Branch**: `fix/liff-sync-customer-lineid`  
**Author**: Akenarin Kongdach  
**Commit**: `d6a9760d`  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

| File | Changes |
|------|---------|
| `apps/api/prisma/migrations/20260422090000_backfill_customer_lineid_from_link/migration.sql` | +16 (new file) |
| `apps/api/src/modules/chatbot-finance/services/verification.service.ts` | +8 |

**Total**: 2 files, 24 insertions, 0 deletions

---

## What Changed

`VerificationService.bind()` now syncs `customer.lineId` inside the existing bind transaction after linking the `CustomerLineLink`. Previously, bind() updated `CustomerLineLink` and `chatRoom.customerId` but did not write back to `Customer.lineId`, causing LIFF pages (e.g., `/liff/contract`) to show "ไม่มีสัญญา" even though the chatbot Finance channel was fully linked.

The migration backfills existing rows: sets `customers.line_id` from `customer_line_links` where `channel = 'FINANCE'`, `unlinked_at IS NULL`, and `line_id` is currently null/empty — safe, non-destructive.

---

## Issues Found

### Critical
_None._

### Warning

**W-1 — `customer.update` missing `deletedAt: null` in where clause**  
`apps/api/src/modules/chatbot-finance/services/verification.service.ts` (line ~326)

```typescript
await tx.customer.update({
  where: { id: customerId },   // ← no deletedAt: null
  data: { lineId: lineUserId },
});
```

Per `database.md`: *"ทุก query ต้อง include `where: { deletedAt: null }`"*. As written, this would write `lineId` to a soft-deleted customer if `customerId` somehow refers to one.

Risk is low in practice — the transaction validates the customer earlier (line ~134 uses `where: { phone: { in: phoneVariants }, deletedAt: null }`), so by the time this update runs the customer is known to be active. However, the rule exists as a defence-in-depth convention and should be followed.

**Suggested fix**:
```typescript
await tx.customer.update({
  where: { id: customerId, deletedAt: null },
  data: { lineId: lineUserId },
});
```

### Info

**I-1 — Migration is safe and well-scoped**  
The backfill UPDATE uses a conditional WHERE (`c.line_id IS NULL OR c.line_id = ''`) so it will not overwrite any customer whose `line_id` is already populated. It is also scoped to `channel = 'FINANCE'` and `unlinked_at IS NULL`. No data loss risk.

**I-2 — Atomicity maintained**  
The new `customer.update` is inside the existing `tx` transaction scope, so the sync is atomic with the `CustomerLineLink` write. Consistent state is guaranteed.

---

## Notes

- No financial fields; no Decimal/Number concerns.
- No new controller; no guard concerns.
- No new DTOs.
- The only actionable item is W-1 — a one-line where-clause change.
