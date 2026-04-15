# Pre-Merge Guard Report: chore/quickbuy-step1-reorder

**Date**: 2026-04-15  
**Branch**: `chore/quickbuy-step1-reorder`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Commits ahead of feature base**: 4 (trade-in feature stack)  
**Recommendation**: 🟡 REVIEW — one Warning on Decimal + one Warning on raw fetch (card reader)

---

## Commit Summary (unique to branch)

| Hash | Message |
|------|---------|
| `5886187` | ui(trade-in): reorder Step 1 fields + expand ID upload area |
| `5f6468c` | refactor(trade-in): quickBuy orchestrator + rebrand modal as primary flow |
| `d5fdd24` | feat(trade-in): Quick Buy wizard + seller history + working search |
| `d693dae` | feat: chatbot-finance + trade-in voucher with anti-stolen-goods |

---

## Files Changed (key TS/TSX)

- `apps/web/src/components/trade-in/QuickBuyModal.tsx` — major new component
- `apps/web/src/pages/TradeInPage.tsx` — modified
- `apps/api/src/modules/trade-in/trade-in.controller.ts` — modified
- `apps/api/src/modules/trade-in/trade-in.service.ts` — modified
- `apps/api/src/modules/trade-in/dto/trade-in.dto.ts` — modified (new `QuickBuyTradeInDto`)
- `apps/api/src/modules/journal/journal.service.ts` — modified
- `apps/api/src/modules/chart-of-accounts/chart-of-accounts.service.ts` — modified

---

## Issues

### 🔴 Critical — None found ✅

#### Auth guard check — PASS
Trade-in controller retains `@UseGuards(JwtAuthGuard, RolesGuard)` with `@Roles('OWNER', 'BRANCH_MANAGER', 'SALES')` on all methods — no regression.

#### Soft-delete check — PASS
New trade-in service queries reviewed; `deletedAt: null` present on customer and product lookups.

---

### 🟡 Warning (should fix)

#### W-001 — `Number()` on Decimal `agreedPrice` field
**File**: `apps/api/src/modules/trade-in/trade-in.service.ts`  
**Commit**: `d5fdd24`

```ts
// WRONG
amount: Number(r.agreedPrice ?? 0),
```

`agreedPrice` is a `Decimal` field on the `TradeIn` model. Use `Prisma.Decimal` or `.toNumber()` only at serialisation:

```ts
// CORRECT — at journal entry creation boundary
amount: new Prisma.Decimal(r.agreedPrice ?? 0),
// OR if the journal expects a plain number:
amount: r.agreedPrice?.toNumber() ?? 0,
```

#### W-002 — Raw `fetch()` to local card reader daemon
**File**: `apps/web/src/components/trade-in/QuickBuyModal.tsx`  
**Commit**: `d5fdd24`

```ts
const res = await fetch('http://localhost:3457/api/read-card');
```

This calls a local hardware card reader daemon (not the backend API), so it technically cannot use `api.get()`. However:
- The URL `localhost:3457` is hardcoded — should be a `VITE_CARD_READER_URL` env var or a constant in `src/constants/`
- There is no timeout or AbortController — a hung card reader will stall the UI indefinitely
- Error handling exists (`if (!res.ok)`) but the `catch` path is missing if the daemon is not running (the `fetch` itself will reject)

**Recommended fix**:
```ts
const CARD_READER_URL = import.meta.env.VITE_CARD_READER_URL ?? 'http://localhost:3457';
const ac = new AbortController();
const timeout = setTimeout(() => ac.abort(), 5000);
try {
  const res = await fetch(`${CARD_READER_URL}/api/read-card`, { signal: ac.signal });
  ...
} catch (err) {
  if (err instanceof Error && err.name === 'AbortError') {
    toast.error('หมดเวลาอ่านบัตร — กรุณาลองใหม่');
  } else {
    toast.error('ไม่สามารถเชื่อมต่อเครื่องอ่านบัตร');
  }
} finally {
  clearTimeout(timeout);
}
```

---

### 🔵 Info

#### I-001 — `invalidateQueries` present ✅
`queryClient.invalidateQueries({ queryKey: ['trade-ins'] })` is called in the `onSuccess` handler of `quickBuyMutation` in `TradeInPage.tsx`.

#### I-002 — `QuickBuyTradeInDto` has proper validation ✅
New DTO includes `@IsString`, `@IsOptional`, `@IsNotEmpty`, `@IsIn` decorators with Thai error messages like `'กรุณาระบุชื่อผู้ขาย'`.

#### I-003 — UI reorder is cosmetic ✅
`5886187` only reorders form fields and expands the ID upload area — no logic changes, low risk.

---

## Action Required

1. Fix **W-001**: Change `Number(r.agreedPrice ?? 0)` to use `Prisma.Decimal` or `.toNumber()` at the JSON boundary only.
2. Fix **W-002**: Extract `localhost:3457` to a constant/env var, add `AbortController` timeout (5s), and add a `catch` for when the card reader daemon is not running.
