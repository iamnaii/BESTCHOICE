# Merge Guard Report — chore/trade-in-orchestrator-rebrand

**Branch**: `chore/trade-in-orchestrator-rebrand`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Review Date**: 2026-04-14  
**Reviewer**: Pre-Merge Guard (automated)  
**Recommendation**: 🟡 **REVIEW** (fix C-1 before merge)

---

## Note on History

This branch has 1,219 commits and does not share a reachable merge-base with current `origin/main` (main has 64 commits). The branch represents an older, longer-lived development line. Review focused on the **3 newest commits** unique to this branch vs its predecessor state.

---

## Unique Commits (newest 3)

| Hash | Message | Files Changed |
|------|---------|---------------|
| `5f6468cf` | refactor(trade-in): quickBuy orchestrator + rebrand modal as primary flow | `trade-in.service.ts` (164 lines), `QuickBuyModal.tsx` (16 lines) |
| `d5fdd241` | feat(trade-in): Quick Buy wizard + seller history + working search (#418) | ~350 lines across trade-in service + QuickBuyModal |
| `d693daec` | feat: chatbot-finance + trade-in voucher with anti-stolen-goods (#417) | multiple files |

---

## Issues by Severity

### 🔴 CRITICAL — Must Fix Before Merge

#### C-1: `Number()` on money/Decimal fields in `trade-in.service.ts`

**File**: `apps/api/src/modules/trade-in/trade-in.service.ts`

Two instances use `Number()` to convert Prisma `Decimal` money fields to JavaScript number:

```typescript
// Line 449 — seller history response
amount: Number(r.agreedPrice ?? 0),

// Line 519 — voucher verification response
amount: Number(tradeIn.agreedPrice ?? tradeIn.offeredPrice ?? 0),
```

Both `agreedPrice` and `offeredPrice` are declared as `@db.Decimal(12, 2)` in `schema.prisma`. Per `database.md` and `coding-standards.md`:

> ใช้ `Decimal` เท่านั้น: `@db.Decimal(12, 2)` — **ห้ามใช้ Float หรือ Int** สำหรับจำนวนเงิน

Converting a `Prisma.Decimal` to `Number` loses precision for large values and breaks the Decimal invariant established in the v2 and v4 hardening sprints (53 instances fixed across 12 services). This branch re-introduces the pattern.

**Fix options:**

Option A — Keep as Decimal (preferred for amounts stored/passed further):
```typescript
amount: r.agreedPrice ?? new Prisma.Decimal(0),
```

Option B — Return as formatted string (for display-only API responses):
```typescript
amount: (r.agreedPrice ?? new Prisma.Decimal(0)).toFixed(2),
```

Verify which type the API consumer (frontend) expects and apply consistently.

---

### 🟡 WARNING — Should Fix Before Merge

#### W-1: Hardcoded card-reader localhost URL in React component

**File**: `apps/web/src/components/trade-in/QuickBuyModal.tsx`, line 135

```typescript
const res = await fetch('http://localhost:3457/api/read-card');
```

The port `3457` for the PJ-Soft card-reader local agent is hardcoded. If the native agent changes port (or needs to be configured per-machine), this silently fails with a network error.

**Fix**: Use a Vite environment variable with a sensible fallback:
```typescript
const CARD_READER_BASE = import.meta.env.VITE_CARD_READER_URL ?? 'http://localhost:3457';
const res = await fetch(`${CARD_READER_BASE}/api/read-card`);
```
Add `VITE_CARD_READER_URL=http://localhost:3457` to `.env.example`.

#### W-2: Raw `fetch()` in React component without timeout

**File**: `apps/web/src/components/trade-in/QuickBuyModal.tsx`, `readFromCardReader()` function

The card-reader call uses raw `fetch()` without an `AbortController` timeout. A frozen or unresponsive card-reader agent will hang the UI indefinitely. On a localhost connection, a 3-second timeout is appropriate.

**Fix**:
```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 3000);
try {
  const res = await fetch(`${CARD_READER_BASE}/api/read-card`, { signal: controller.signal });
  // ...
} finally {
  clearTimeout(timeoutId);
}
```

Note: `fetch()` is acceptable here (not the BESTCHOICE API, but a local hardware service) — the issue is the missing timeout, not the use of `fetch()` itself.

#### W-3: Non-atomic `quickBuy()` orchestrator (acknowledged trade-off)

**File**: `apps/api/src/modules/trade-in/trade-in.service.ts`, `quickBuy()` method

The orchestrator runs 4 sequential database transactions:
1. `create()` → `PENDING_APPRAISAL`
2. `appraise()` → `APPRAISED`
3. `accept()` → `ACCEPTED`
4. `voucher.allocate()` → voucher number assigned

If any stage fails mid-way, the record is left in an intermediate state. The commit message acknowledges this: "ถ้า fail กลางทาง → record ค้างใน intermediate state (PENDING/APPRAISAL) ซึ่งสามารถกู้คืนได้ผ่าน legacy modals".

This is an accepted trade-off, but consider:
- Adding an automated cleanup job for `PENDING_APPRAISAL` records older than 24h with no subsequent activity
- Or wrapping stages 2–4 in a compensation pattern that rolls back `create()` on failure

Not a blocker for merge, but should be tracked as a follow-up ticket.

---

### 🔵 INFO

#### I-1: `quickBuy()` makes an extra DB roundtrip at the end

**File**: `apps/api/src/modules/trade-in/trade-in.service.ts`

After the 4-stage orchestration, the method re-fetches the record to read `imeiBlacklistResult`:
```typescript
const final = await this.prisma.tradeIn.findUnique({
  where: { id: created.id },
  select: { imeiBlacklistResult: true },
});
```
The `create()` call at stage 1 already returns the created record. Passing `imeiBlacklistResult` through the return chain would eliminate this extra query.

#### I-2: `parseInt()` for ID card validation

**File**: `apps/api/src/modules/trade-in/trade-in.service.ts`, lines 30/32

```typescript
for (let i = 0; i < 12; i++) sum += parseInt(id[i]) * (13 - i);
return check === parseInt(id[12]);
```

`parseInt()` is used on individual digit characters of the Thai national ID card — this is a validation checksum calculation, not a money field. This usage is correct and acceptable.

#### I-3: QuickBuy modal visual rebrand

UI color changes (amber → emerald), icon change (Zap → ShoppingBag), and subtitle update. Pure UI change, no logic impact.

---

## Security Review

- ✅ `trade-in.service.ts`: All new queries include `deletedAt: null` filters
- ✅ No new controller endpoints — orchestrator is called via existing `POST /trade-ins/quick-buy`
- ✅ Guard and roles on the existing controller are unchanged
- ✅ No new raw `$queryRaw` calls
- ✅ No hardcoded secrets or API keys

---

## Relationship to `chore/quickbuy-step1-reorder`

`chore/quickbuy-step1-reorder` adds a single UI commit on top of this branch. The quickbuy branch's separate report correctly marks it as APPROVE (pending base branch merge). Fixing C-1 and W-1/W-2 here will unblock both branches.

---

## Fix Checklist

- [ ] Replace `Number(r.agreedPrice ?? 0)` with `Prisma.Decimal` equivalent on line 449
- [ ] Replace `Number(tradeIn.agreedPrice ?? tradeIn.offeredPrice ?? 0)` on line 519
- [ ] Add `VITE_CARD_READER_URL` env var + update `.env.example`
- [ ] Use env var in `QuickBuyModal.tsx` line 135
- [ ] Add 3s AbortController timeout to card-reader fetch

---

*Generated by Pre-Merge Guard agent (run 2) — 2026-04-14*  
*Coverage complement: previous run skipped this branch (no merge-base with main detected)*
