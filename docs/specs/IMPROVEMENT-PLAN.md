# BESTCHOICE Improvement Plan

> Generated: 2026-04-07
> Completed: 2026-04-07 (overnight session)
> Status: DONE — pending review + E2E test run

## Summary

| Phase | Description | Status | Files Changed |
|-------|------------|--------|---------------|
| 1 | Security + Logic Fixes | DONE | 15 files |
| 2 | Accounting (separated) | DONE | 1 file + spec |
| 3 | Dead Code Removed | DONE | 3 items deleted |
| 4 | UX Improvements | DONE | 8 files |
| 5 | E2E Tests Written | DONE (needs run) | 4 new test files |

**Total: 29 files changed, ~1,827 lines added, ~9,107 lines removed**

---

## Phase 1: Security + Logic Fixes — DONE

### Security Bugs Fixed
- [x] **C-1**: PaySolutions `create-intent` บังคับ lineId ทั้ง controller + service
- [x] **C-2**: เพิ่ม `{ deletedAt: null }` filter ใน payments include — **10 ไฟล์ทั่ว codebase**
- [x] **C-3**: Users findAll เพิ่ม deletedAt filter + count filter
- [x] **W-4**: Receipt PDF เพิ่ม `escapeHtml()` ป้องกัน HTML injection
- [x] **W-5**: PaySolutions webhook reject เมื่อ merchantId ว่าง

### Logic Conflicts Fixed
- [x] FINANCE_MANAGER ดูข้ามสาขาได้ใน contracts (เหมือน payments)
- [x] Suppliers `findOne()` เพิ่ม deletedAt check
- [x] Trade-in accept/reject/complete ครอบ `$transaction` ป้องกัน race condition

---

## Phase 2: Accounting — SEPARATED

### Done in this session
- [x] Commission อ่านจาก CommissionRule แทน hardcode 3% (sales.service.ts x2)

### Separated as new project
- See: `docs/specs/SPEC-accounting-journal-system.md`
- Auto journal entries, Trial Balance — scope ~1-2 weeks

### Already existed (audit overcounted)
- P&L report (accounting.service.ts:424)
- Balance Sheet (accounting.service.ts:811)
- installment.util.ts ใช้ satang-based arithmetic อยู่แล้ว

---

## Phase 3: Dead Code Removed — DONE

- [x] `apps/web/src/utils/thaiNumberToText.ts` (unused utility)
- [x] `apps/api/src/utils/pagination.util.ts` (unused utility)
- [x] `apps/api/src/modules/address/` (entire folder, 7,575 lines, never registered)

---

## Phase 4: UX Improvements — DONE

### Modals → Full-screen Overlay (6 converted)
- [x] CustomerCreateModal (ContractCreatePage)
- [x] CustomerEditModal (components/contract)
- [x] CustomersPage AddCustomer modal
- [x] CreatePOModal (PurchaseOrdersPage)
- [x] GoodsReceivingModal (PurchaseOrdersPage)
- [x] PODetailModal (PurchaseOrdersPage)

Pattern: sticky header + scrollable sections + sticky footer + section cards with colored icons

### Tooltips Added
- [x] เงินดาวน์ — อธิบายว่า SHOP เก็บ ไม่ผ่าน FINANCE
- [x] ยอดปล่อย (Loan) — ราคาขาย - ดาวน์
- [x] ค่าคอมหน้าร้าน — % ที่ FINANCE จ่ายให้ SHOP
- [x] รวมยอดจัดไฟแนนซ์ — สูตรการคำนวณ

### LIFF Error Messages Improved
- [x] Error page — เพิ่มคำแนะนำ 3 ข้อ (เปิดใหม่, ตรวจ LINE, ติดต่อร้าน)
- [x] Payment failed — เพิ่มสาเหตุที่เป็นไปได้ (เงินไม่พอ, QR หมดอายุ, connection)

---

## Phase 5: E2E Tests — WRITTEN (needs server to run)

### New test files
- [x] `e2e/contract-creation.spec.ts` — สร้างสัญญา flow (5 tests)
- [x] `e2e/payment-recording.spec.ts` — บันทึกชำระเงิน + role access (7 tests)
- [x] `e2e/trade-in-flow.spec.ts` — รับซื้อเครื่อง (4 tests)
- [x] `e2e/early-payoff.spec.ts` — ปิดยอดก่อนกำหนด (4 tests)

### To run
```bash
cd apps/web && npm run dev  # start dev server first
npx playwright test          # run all tests
```

---

## Type Check Status
- API: PASS
- Web: PASS

## Remaining Work (Future)
1. **Accounting Journal System** — see `SPEC-accounting-journal-system.md`
2. **Duplicate consolidation** — Exchange service, branch access utility, modal dedup
3. **More E2E tests** — inter-company flow, LIFF payment flow
