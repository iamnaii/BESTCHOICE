# Pre-Merge Guard Report

**Branch**: `claude/sleepy-gauss-9wojq6`
**Date**: 2026-06-12
**Author**: Claude <noreply@anthropic.com>
**Base**: `origin/main` (7c3f4cb4)
**Commits ahead**: 2

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/web/src/components/contacts/ContactCombobox.tsx` | Label rename: ผู้ขาย → ผู้จัดจำหน่าย |
| `apps/web/src/components/contacts/CreateContactModal.tsx` | Fix modal close ordering before `onCreated` callback |
| `apps/web/src/config/menu.ts` | Label rename in BRANCH_MANAGER + OWNER nav configs |
| `apps/web/src/pages/ContactDetailPage.tsx` | Label + link text rename |
| `apps/web/src/pages/ContactsPage.tsx` | Replace `navigate('/customers')` / `navigate('/suppliers')` in dropdown with inline `CreateContactModal` |
| `apps/web/src/pages/__tests__/ContactDetailPage.test.tsx` | Update assertions to match renamed labels |
| `apps/web/src/pages/__tests__/ContactsPage.test.tsx` | Add 3 new tests covering modal open/submit/dismiss paths |

**Total**: 7 files, +138 / -38 lines

---

## Issues

### Critical
_None_

### Warning
_None_

### Info

**I-1 — Modal close-before-onCreated ordering (design note)**
- File: `apps/web/src/components/contacts/CreateContactModal.tsx`
- The PR intentionally calls `onOpenChange(false)` before `onCreated()`. The comment explains that parent components may navigate on `onCreated`, unmounting the modal — closing first prevents a state-update-on-unmounted-component warning. The fix is correct and well-commented. Not an issue; recorded here for awareness.

**I-2 — `useNavigate` dropped from ContactsPage dropdown for customers**
- File: `apps/web/src/pages/ContactsPage.tsx`
- "เพิ่มลูกค้า" now opens `CreateContactModal` (role=CUSTOMER) instead of navigating to `/customers`. Post-create navigates to `/contacts/:id` via the modal's `onCreated`. This changes UX flow. Confirm with owner that inline customer creation (not redirect to CustomerIntakePage) is intentional.

---

## Security Checklist

| Check | Result |
|-------|--------|
| No new controllers/routes | ✅ — Frontend-only changes |
| No missing `@UseGuards` | ✅ — N/A (no backend changes) |
| No `Number()` on financial fields | ✅ — N/A |
| No `deletedAt: null` missing | ✅ — N/A |
| No raw `fetch()` / raw axios | ✅ — Uses `api.get()`/`api.post()` pattern via contactsApi |
| `queryClient.invalidateQueries()` present | ✅ — Existing in CreateContactModal after mutation |
| No hardcoded secrets | ✅ |

---

## Recommendation: ✅ APPROVE

Pure UI/UX improvement — label rename (ผู้ขาย → ผู้จัดจำหน่าย) + inline contact creation in ContactsPage. No backend changes, no security surface. Tests cover the new modal flow. The one UX behavior change (inline customer creation vs. navigate to /customers) should be confirmed with the product owner, but is not a technical blocker.
