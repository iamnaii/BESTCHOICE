# Merge Guard Report — fix/hardening-non-accounting

**Date**: 2026-04-16  
**Branch**: `fix/hardening-non-accounting`  
**Author**: iamnaii (akenarin.ak@gmail.com)  
**Commits ahead of main**: 2 unique commits (Phase 2 chat + hardening)  
**Files changed**: 11 new, 244 modified (TypeScript/TSX)

---

## Summary

This branch completes Phase 2 of the chat feature (WebSocket events, file upload, read receipts, KB suggestions) and adds hardening fixes for security, DTOs, FINANCE_MANAGER role, SMS retry, and Dashboard MoM. New page components (AssetManagement, POS, TradeIn, Suppliers, etc.) are added to the frontend. API patterns in new pages are correct. Critical issue is the same `Number()` on `amountDue` as in the chatbot branch (shared cron code).

---

## Issues by Severity

### 🔴 CRITICAL — Must fix before merge

#### C-001 · `Number(payment.amountDue)` in LINE notification cron (2 instances)
**File**: LINE payment reminder / overdue notification cron  
**Same issue as `feat/chatbot-production-ready` C-001** — this branch inherits the same cron code:

```ts
// ❌ Wrong
amountDue: Number(payment.amountDue),  // 2 occurrences
```

```ts
// ✅ Correct
amountDue: payment.amountDue.toNumber(),
```

---

### 🟡 WARNING — Should fix

#### W-001 · Hardcoded `text-gray-*` / `bg-gray-*` in new TSX files
**Violates**: `.claude/rules/frontend.md` — design token rule  
New page components and shared components use hardcoded gray colors:

```tsx
// ❌ Wrong — found in new pages
<tr className="bg-gray-50">                          // table header row
<th className="text-xs font-medium text-gray-500">   // table header text
<div className="p-12 text-center text-gray-400">     // empty state
<h3 className="text-sm font-semibold text-gray-700"> // section heading

// ✅ Correct
<tr className="bg-muted">
<th className="text-xs font-medium text-muted-foreground">
<div className="p-12 text-center text-muted-foreground">
<h3 className="text-sm font-semibold text-foreground">
```

Sidebar navigation items also use `text-gray-300 hover:text-white` — acceptable inside guaranteed-dark sidebar panels, but should be confirmed.

---

### 🔵 INFO

#### I-001 · New frontend pages follow correct API patterns
All 11 new pages use `api.get()` / `api.post()` from `@/lib/api`, `useQuery`/`useMutation` from React Query, and `queryClient.invalidateQueries()` after mutations. Verified: `AssetManagementPage`, `POSPage`, `TradeInPage`.

#### I-002 · Dispose mutation correctly invalidates cache
```ts
const disposeMutation = useMutation({
  mutationFn: (id) => api.post(`/assets/${id}/dispose`),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['assets'] });
  },
});
```

#### I-003 · No new unguarded controllers
No new controller files detected — all controller changes are modifications to existing guarded controllers.

#### I-004 · Phase 2 chat additions (WS, file upload, read receipts)
New `session-manager.service.spec.ts` added. WS event handlers and file upload routes should be verified for guard coverage in the chat module — not detectable via diff alone, recommend manual check of `chat-engine` module controller decorators.

---

## Recommendation

```
🟡 REVIEW
```

Branch is well-structured. New frontend pages have correct patterns. Single critical fix needed (C-001 — same `Number()` issue as chatbot branch, likely same file). Design token violations are widespread but cosmetic. After fixing C-001 and W-001, this branch is mergeable.

**Required before merge**:
1. Replace `Number(payment.amountDue)` with `.toNumber()` in LINE cron (C-001)
2. Replace `text-gray-*` / `bg-gray-*` in non-dark page contexts with semantic tokens (W-001)
3. Manual spot-check: verify `chat-engine` WebSocket controller has guards (I-004)
