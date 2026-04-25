# Pre-Merge Guard Report — 2026-04-25

**Reviewed by**: Pre-Merge Guard Agent  
**Date**: 2026-04-25  
**Branches reviewed**: 3 (most recently updated unmerged branches)

---

## Branch 1 — `fix/hosting-header-order`

**Author**: Akenarin Kongdach  
**Committed**: 2026-04-24 18:19 +07:00  
**Unique commit**: `9292b915 fix(hosting): reorder header rules so JS/CSS keep immutable cache`

### File Changes
```
firebase.json | 40 ++++++++++++++++++++--------------------
1 file changed, 20 insertions(+), 20 deletions(-)
```

### Analysis

No TypeScript/TSX changes — only `firebase.json` header rule reordering.

**Root problem fixed**: Firebase applies header rules in document order; later rules overwrite earlier ones for the same header key. In the prior `fix/hosting-nocache-spa-html` state, the catch-all `**` rule (containing `Cache-Control: no-cache`) was listed **last**, meaning it silently overrode the `**/*.@(js|css)` immutable rule for every JS/CSS asset — defeating long-term caching.

**New order** (correct):
1. `**` — security headers + `no-cache` (catch-all, applied first)
2. `**/*.@(js|css)` — `public, max-age=2592000, immutable` (overrides for assets)
3. `**/*.@(svg|png|jpg|jpeg|gif|ico|woff2)` — `public, max-age=2592000, immutable`

JS/CSS and static assets now correctly receive the immutable header. HTML (`index.html`) falls through to catch-all → no-cache. This is the intended behavior for a hashed-asset SPA.

### Issues Found

| Severity | Issue |
|----------|-------|
| — | None |

### Recommendation: ✅ APPROVE

---

## Branch 2 — `fix/hosting-nocache-spa-html`

**Author**: Akenarin Kongdach  
**Committed**: 2026-04-24 18:10 +07:00  
**Unique commit**: `208f3bce fix(hosting): no-cache on SPA HTML so deploys take effect immediately`

### File Changes
```
firebase.json | 6 ++++--
1 file changed, 4 insertions(+), 2 deletions(-)
```

### Analysis

Adds `Cache-Control: no-cache, no-store, must-revalidate` to the `**` (catch-all) header block in both hosting configurations. The intent is correct — SPA `index.html` must not be cached by CDN/browser to ensure users always pick up new JS bundle URLs after a deploy.

**However**, this branch is the parent/predecessor of `fix/hosting-header-order`. In isolation it has a header-ordering bug:

- The `**` catch-all block is positioned **last** in the rules list.
- Firebase applies all matching rules; the last matching rule for a given header key wins.
- Result: JS/CSS files match both the immutable rule (first) and the `**` no-cache rule (last) — **no-cache wins**, negating long-term asset caching.

`fix/hosting-header-order` was created immediately after this branch to fix that ordering. **These two branches should not be merged independently** — only `fix/hosting-header-order` (which contains the corrected final state) should be merged.

### Issues Found

| Severity | Issue | File |
|----------|-------|------|
| ⚠️ Warning | Header rule ordering bug: `**` catch-all placed last overrides `**/*.@(js\|css)` immutable rule, breaking long-term asset caching for every JS/CSS file | `firebase.json` |
| ℹ️ Info | This branch is superseded by `fix/hosting-header-order` — merging this branch alone would introduce a regression | — |

### Recommendation: ⚠️ REVIEW — do not merge in isolation; `fix/hosting-header-order` supersedes this branch

---

## Branch 3 — `feat/liff-early-payoff-direct-paysolutions`

**Author**: Akenarin Kongdach  
**Committed**: 2026-04-24 17:55 +07:00  
**Unique commit**: `37e37ea4 feat(liff-early-payoff): skip /pay/{token} landing, jump to PaySolutions`

### File Changes
```
apps/web/src/pages/liff/LiffEarlyPayoff.tsx | 22 +++++++++++++++++++---
1 file changed, 19 insertions(+), 3 deletions(-)
```

### Analysis

Rewrites the early-payoff mutation in `LiffEarlyPayoff.tsx` to call `/paysolutions/create-intent` directly, bypassing the previous two-step flow (`/line-oa/liff/early-payoff` → `/pay/{token}` landing page).

**What changed:**
- Old: `liffApi.post('/line-oa/liff/early-payoff', { lineId, contractId })` → redirected to `/pay/{token}` landing
- New: `liffApi.post('/paysolutions/create-intent', { contractId, amount, description, lineId })` → redirected to `paymentUrl` directly

**Positive aspects:**
- One fewer redirect step improves UX for LIFF (mobile) users.
- Null check on `quote` before mutation (`if (!quote) throw new Error(...)`) is correct.
- `toast.error()` fallback when `paymentUrl` is absent is correct.

### Issues Found

| Severity | Issue | File / Line |
|----------|-------|-------------|
| ⚠️ Warning | **Endpoint auth model change**: Previous flow used `/line-oa/liff/early-payoff` which is under the `chatbot-finance-liff` module (intentionally public, authenticated by LIFF token). The new `/paysolutions/create-intent` endpoint may sit under the `paysolutions` module, which is listed as intentionally public for **webhook callbacks only** (not for customer-initiated payment creation). Confirm the backend endpoint verifies the `lineId` claim and is not callable anonymously. | `LiffEarlyPayoff.tsx:70–79` |
| ⚠️ Warning | **Validation bypass documented in comment**: `// installmentNo is intentionally omitted so backend skips per-installment amount validation`. Bypassing server-side amount validation needs explicit sign-off — confirm the `create-intent` handler enforces that `amount` matches the contract's outstanding balance server-side and cannot be manipulated by a modified LIFF client. | `LiffEarlyPayoff.tsx:73–78` |
| ℹ️ Info | `Number(quote.totalPayoff)` converts a Decimal for the JSON payload — acceptable at the HTTP boundary, but confirm the backend re-parses as Decimal before any arithmetic. | `LiffEarlyPayoff.tsx:77` |

### Recommendation: ⚠️ REVIEW — approve after confirming `/paysolutions/create-intent` backend auth model and server-side amount validation

---

## Summary

| Branch | Files Changed | Critical | Warning | Info | Decision |
|--------|--------------|----------|---------|------|----------|
| `fix/hosting-header-order` | `firebase.json` | 0 | 0 | 0 | ✅ APPROVE |
| `fix/hosting-nocache-spa-html` | `firebase.json` | 0 | 1 | 1 | ⚠️ REVIEW (superseded) |
| `feat/liff-early-payoff-direct-paysolutions` | `LiffEarlyPayoff.tsx` | 0 | 2 | 1 | ⚠️ REVIEW |

### Merge Order Recommendation
1. Merge `fix/hosting-header-order` first (supersedes `fix/hosting-nocache-spa-html`; close the nocache branch without merging).
2. For `feat/liff-early-payoff-direct-paysolutions`: verify the two Warning items with the backend engineer before merging.
