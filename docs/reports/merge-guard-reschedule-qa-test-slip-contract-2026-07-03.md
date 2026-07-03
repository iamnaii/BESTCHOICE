# Merge Guard Report — fix/reschedule-qa-test-slip-contract

**Date**: 2026-07-03  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Last commit**: test(web): update reschedule QA test to the ref+slip contract (post #1343) — 11h ago  
**Base**: origin/main (4f0ef17f)

---

## File Changes Summary

1 file changed, +22 / -1 lines

| Area | File |
|------|------|
| Frontend test | `apps/web/src/pages/PaymentsPage/components/__tests__/RescheduleOverlay.test.tsx` |

---

## Issues

### Critical

None.

### Warning

None.

### Info

**I1 — Test uses `vi.spyOn(globalThis, 'fetch')` for S3 presigned PUT**  
This correctly mocks the S3 presigned PUT (which uses raw `fetch` in `useSlipUpload.ts`). The mock returns `{ ok: true }` which is the minimal expected shape. Acceptable pattern — no concern.

**I2 — Signed URL mock returns hardcoded `https://s3.test/put`**  
The mock uses `url === '/shop/upload/signed-url'` as the condition to return the signed URL response. This is correct and consistent with how the `api` mock is structured in this test file.

---

## Recommendation

**APPROVE** — Pure test update. Adds missing assertions that BANK_TRANSFER requires both `transactionRef` AND `slipUrl` (enforces the ref+slip contract introduced in PR #1343). No production code changes. No security or correctness concerns.
