# Merge Guard Report — fix/reschedule-qa-test-slip-contract

**Date**: 2026-07-04  
**Branch**: `fix/reschedule-qa-test-slip-contract`  
**Author**: iamnaii (akenarin.ak@gmail.com)  
**Commits ahead of main**: 1  
**Last commit**: `de4613ef` — test(web): update reschedule QA test to the ref+slip contract (post #1343)

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/web/src/pages/PaymentsPage/components/__tests__/RescheduleOverlay.test.tsx` | +22, -1 |

**Total**: 1 file, 22 insertions, 1 deletion — test-only change.

---

## Analysis

This branch adds a single test update to `RescheduleOverlay.test.tsx`. It:

1. Adds a mock for `/shop/upload/signed-url` presigned URL endpoint in the test helper
2. Renames the test to reflect that **both** `เลขอ้างอิง` AND a slip file are required for TRANSFER payment (not just ref number)
3. Adds `vi.spyOn(globalThis, 'fetch')` to mock the S3 PUT presigned upload (intentionally uses raw `fetch()` as this is the actual S3 upload path, not the API client — correct)
4. Adds `user.upload()` step for the slip file before asserting submit is enabled
5. Asserts `slipUrl` is included in the posted payload

The `vi.spyOn(globalThis, 'fetch')` in a test context is appropriate since the actual slip upload path uses raw `fetch()` (the presigned PUT goes directly to S3, bypassing the API client). The test spy is properly restored with `fetchSpy.mockRestore()`.

---

## Issues

**None found.**

---

## Recommendation: ✅ APPROVE

Clean test-only change. No production code modified. The test accurately reflects the behavior added in PR #1343 (slip required for TRANSFER in RescheduleOverlay). No security, correctness, or convention issues.
