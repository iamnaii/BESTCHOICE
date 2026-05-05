# Merge Guard Report — fix/backfill-status-filter

**Date**: 2026-05-05  
**Branch**: `fix/backfill-status-filter`  
**Author**: Akenarin Kongdach (iamnaii@gmail.com)  
**Reviewed at**: 2026-05-05T11:16 UTC  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| File | Changes |
|------|---------|
| `apps/api/src/cli/backfill-installment-schedules.cli.ts` | +1 / -1 |

**Total**: 1 file, 1 line changed.

---

## Change Detail

```diff
-  workflowStatus: 'ACTIVE' as any,
+  status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT', 'LEGAL'] as any },
```

The original query used a non-existent field `workflowStatus` with `as any` — it would silently match no contracts. The fix switches to the actual `Contract.status` enum field and broadens the filter to include all "live" statuses (ACTIVE, OVERDUE, DEFAULT, LEGAL) so the backfill CLI correctly processes contracts that may have progressed past ACTIVE since activation.

---

## Issues

### Critical
None.

### Warning
None.

### Info

#### I-1: `as any` on enum values
`['ACTIVE', 'OVERDUE', 'DEFAULT', 'LEGAL'] as any` — the `as any` cast suggests the TypeScript enum for `ContractStatus` may not be importable in the CLI context, or the filter type doesn't accept a string array. Consider importing the `ContractStatus` enum from the Prisma client instead of casting:
```ts
import { ContractStatus } from '@prisma/client';
status: { in: [ContractStatus.ACTIVE, ContractStatus.OVERDUE, ContractStatus.DEFAULT, ContractStatus.LEGAL] },
```

---

## Positive Highlights

- Correct fix: broadening to OVERDUE/DEFAULT/LEGAL ensures the backfill reaches contracts that moved past ACTIVE before the schedules were generated.
- One-line change, trivially reviewable.
