# Merge /receipts into /payments as a tab

**Date:** 2026-04-20
**Status:** Approved — ready for plan
**Scope:** Frontend-only. No backend API changes.

## Problem
- Sidebar has 2 separate entries for payments-related pages: `รับชำระค่างวด` (/payments) and `ใบเสร็จ` (/receipts)
- Workflow ที่ใช้จริง: บัญชี/ผจก.การเงิน บันทึกชำระ → print ใบเสร็จต่อเนื่อง → ต้องสลับหน้า
- PaymentsPage มี tab system อยู่แล้ว (pending | summary | slip-review) — เพิ่ม tab ที่ 4 คือ "ใบเสร็จ" ได้ตรงๆ

## Goal
- รวมข้อมูล `/receipts` page ไปเป็น tab ที่ 4 ใน `/payments`
- ลบ entry sidebar "ใบเสร็จ" (ACCOUNTANT / FINANCE / OWNER / BM)
- `/receipts` URL redirect ไป `/payments?tab=receipts` (backward compat)

## Non-goals
- ไม่เปลี่ยน backend `/receipts` endpoints
- ไม่เปลี่ยน filter logic ของ ReceiptsPage (copy เดิม)
- ไม่ merge กับ tab อื่น (pending/summary/slip-review ยังแยก)
- ไม่เปลี่ยน receipt types, voided flow, หรือ print flow

## Design

### URL routing
- `/payments` (default tab = pending)
- `/payments?tab=receipts` = receipts view
- `/receipts` → `<Navigate to="/payments?tab=receipts" replace />` (preserve bookmarks)

### Permission
- tab "ใบเสร็จ" แสดงเฉพาะ role ที่เคย access /receipts ได้ (OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT)
- SALES ไม่เห็น tab นี้ (existing API guard จะ return 403 อยู่แล้วถ้ายิงเข้าไปได้)

### Component layout
- ย้าย ReceiptsPage body → new component `ReceiptsTab.tsx` ใน `apps/web/src/pages/PaymentsPage/components/`
- เพิ่ม tab button ใน PaymentsPage tabs bar
- tab state extends: `'pending' | 'summary' | 'slip-review' | 'receipts'`

### Menu changes
- `apps/web/src/config/menu.ts` — ลบ entry `ใบเสร็จ` (path: `/receipts`) ออกจาก OWNER / FINANCE_MANAGER / ACCOUNTANT sections (3 เมนู)
- ไม่ต้องเพิ่ม entry ใหม่ — ใช้ entry `รับชำระค่างวด` เดิม

### CommandPalette
- อัปเดต entry `ใบเสร็จรับเงิน` ให้ path = `/payments?tab=receipts`

## Out of scope
- Remove `ReceiptsPage.tsx` file entirely — keep it imported as the tab content (easier refactor, can be deleted in follow-up)

## Risks
- Bookmarks ใน production ใช้ `/receipts` → mitigated by redirect route
- E2E tests อ้างอิง `/receipts` — update selectors หลังย้าย
- ผู้ใช้คุ้นชินกับเมนู "ใบเสร็จ" → add tab label ชัดเจน + อาจ announce ใน release notes

## Success metrics
- Sidebar ลดลง 1 entry (3 roles)
- User สามารถ print ใบเสร็จหลังบันทึกชำระโดยไม่ต้อง navigate page
- Type check passes, no runtime errors
