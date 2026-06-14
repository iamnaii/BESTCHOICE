# Pre-Merge Guard Report — fix/fb-webhook-integration-config

**Date**: 2026-06-14  
**Branch**: `fix/fb-webhook-integration-config`  
**Author**: Akenarin Kongdach (akenarin.ak@gmail.com)  
**Commits ahead of main**: 18  
**Recommendation**: ⚠️ REVIEW — merge after fixing 2 warnings

---

## File Changes Summary

| Area | Files | Lines |
|------|-------|-------|
| `feat(letters)` — /letters management page + PDF | ~34 | +5036/-206 |
| `feat(letters)` — Puppeteer PDF templates (overdue letters) | 4 | +562/-5 |
| `fix(letters)` — polish, logo embed, layout, modal | ~8 | moderate |
| `fix(facebook-webhook)` — read tokens from IntegrationConfig | 3 | +90/-15 |
| `feat(canned-response)` — per-channel tabs, postback routing | ~10 | moderate |

Total unique commits: 18, including letters feature (feat+fix), facebook webhook security fix, canned-response features.

---

## Issues Found

### ⚠️ Warning — `Number()` / `.toNumber()` on money fields in PDF service

**File**: `apps/api/src/modules/overdue/letter-pdf.service.ts`  
**Commits**: `8a8c7dc3`, `8a0d84d6`

Decimal financial values are converted to JavaScript `number` for Puppeteer template data:

```ts
// 8a8c7dc3 — letter-pdf.service.ts
const principal = principalDec.toNumber();       // ← money field
const lateFee   = lateFeeDec.toNumber();         // ← money field
const outstanding = principalDec.plus(lateFeeDec).toNumber();  // ← money field

// passed into template:
monthlyPayment: Number(letter.contract.monthlyPayment ?? 0),  // ← money field
```

Values are display-only (not stored back to DB), so there's no data corruption risk. However, floating-point representation can silently misformat amounts in **legal collection letters** — e.g. 1000.10 → 1000.1000000000001. This matters because these are formal ติดตามหนี้ documents.

**Fix**: Use `Decimal.toFixed(2)` or `.toString()` and format in the template, instead of converting to `number`. Example:
```ts
const principal = principalDec.toFixed(2);     // "1234.50" — safe string
const outstanding = principalDec.plus(lateFeeDec).toFixed(2);
```

`totalMonths` (`Number(letter.contract.totalMonths ?? 0)`) is an integer field, not a money field — lower risk.

---

### ⚠️ Warning — `Number()` in seed/backfill script on money fields

**File**: `apps/api/prisma/seed.ts` or letters-mock seed (commit `6e328e29`)  
**Commit**: `6e328e29`

```ts
const monthly = Number(c.monthlyPayment) || 1500;
Number(p.amountDue) > Number(p.amountPaid ?? 0)
```

Lower severity — seed files only affect dev environment. Boolean comparisons (`>`) are safe even with float precision at realistic values. But `Number(c.monthlyPayment) || 1500` used for installment schedule generation in seed could produce imprecise values.

**Fix**: Use `.equals()` or `Decimal` comparisons; use `monthlyPayment.toFixed(2)` for display.

---

## Positive Findings (No Action Required)

### ✅ Facebook webhook security — correctly fixed

**Commit**: `72da1b25`

`FacebookWebhookController` previously read `FB_VERIFY_TOKEN` and `FB_APP_SECRET` from environment variables only. Settings entered in Settings → Integrations (stored in DB via `IntegrationConfig`) were silently ignored, causing webhook verification failures in production.

Fix routes all four handlers (GET verify, POST signature check, data-deletion, deauthorize) through `IntegrationConfig.getConfig('facebook')` with env fallback. Fails closed when both sources are unset.

Tests added: 3 new spec cases covering token match, token mismatch, and empty token (fail-closed).

### ✅ Race condition fix on system user bootstrap

**Commit**: `57b23560`

`getSystemUserId()` changed from `findFirst → create` (P2002 race on concurrent calls) to `prisma.user.upsert` (atomic at DB level). System user role downgraded `OWNER → SALES` (W6 — bot should not appear in owner-only admin queries).

4 new tests prove the fix: concurrent sends, upsert shape, role check, real-staff bypass.

### ✅ FB ChatRoom ordering fix

**Commit**: `57b23560` (C2)

`ChatRoom.findFirst` for Facebook PSID now includes `orderBy: { lastMessageAt: 'desc' }`. Without this, a PSID with multiple rooms (re-engagement) would resolve to the oldest (stale) room.

### ✅ Postback loop guard (W7)

In-memory per-room sliding window: max 5 postback dispatches per 10s. 6th+ is logged and skipped. Prevents A→B→A Quick Reply chain spam. 4 new tests verify rate limit, window expiry, and per-room isolation.

### ✅ Letters controller guards

All new and modified endpoints on `OverdueController` have:
- Class-level `@UseGuards(JwtAuthGuard, RolesGuard)` (inherited, existing)
- Method-level `@Roles(...)` on every new endpoint
- `GET /letters/counts`, `POST /letters/bulk/dispatch` — both properly decorated

### ✅ Frontend patterns

`LettersPage` correctly uses:
- `useQuery` / `useMutation` from `@tanstack/react-query` (no raw `fetch()`)
- `api.get()` / `api.post()` from `@/lib/api`
- `queryClient.invalidateQueries()` after mutations
- Toast notifications via `sonner`

### ✅ `deletedAt: null` filters

All new Prisma queries include `deletedAt: null`. Checked across all 18 commits.

### ✅ No hardcoded secrets or API keys

No secrets, credentials, or hardcoded tokens found in diff.

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 0 | — |
| Warning | 2 | Fix recommended before merge |
| Info | 0 | — |

The Facebook webhook fix is a genuine security improvement (DB config now honoured). The letters feature is structurally sound — guards, patterns, and data access all follow project conventions. The only concern is `Number()` / `.toNumber()` on money fields in PDF template generation, which risks misformatted amounts in legal letters. Fix before merge.
