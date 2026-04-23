# Pre-Merge Guard Report — 2026-04-23

**Reviewed by**: Pre-Merge Guard Agent  
**Date**: 2026-04-23  
**Branches reviewed**: 3 (top by recency among unmerged `fix/` branches)

---

## Branch 1: `fix/liff-skip-root-rewrite`

**Author**: Akenarin Kongdach  
**Last commit**: `0ab6151d` — fix(liff): skip liff.state rewrite when state is "/" (bare rich-menu URI)  
**Committed**: 2026-04-23

### Files Changed
| File | Changes |
|------|---------|
| `apps/web/src/main.tsx` | +4 / −4 (1 logical line change) |

### Change Summary
Adds a guard to the LIFF `liff.state` URL rewrite: skips the rewrite when `liff.state` equals `/` (bare rich-menu URI without a sub-path). Previously, a bare rich-menu URI like `https://liff.line.me/<id>` would set `liff.state=/`, which triggered a rewrite to `window.location = "/" + queryString`, landing on ProtectedRoute and causing a blank/redirect loop.

```diff
-if (liffState) {
+if (liffState && liffState !== '/') {
   window.history.replaceState(null, '', liffState + window.location.search);
 }
```

### Issues Found

**Critical**: None  
**Warning**: None  
**Info**: None

### Recommendation: ✅ APPROVE

Minimal, correct single-line fix. No new controllers, no DB queries, no financial fields touched. Safe to merge.

---

## Branch 2: `fix/line-login-token-via-hash`

**Author**: Akenarin Kongdach  
**Last commit**: `85a2cefb` — fix(line-login): ส่ง id_token ผ่าน query param (แทน hash ที่ WebView strip)  
**Committed**: 2026-04-22

### Files Changed
| File | Changes |
|------|---------|
| `apps/api/src/modules/line-oa/line-login.controller.ts` | +14 / −44 |
| `apps/web/src/hooks/useLiffInit.ts` | +6 / −22 |

### Change Summary
Switches LINE ID token delivery from **httpOnly cookie + one-shot fetch** → **URL query param**. Rationale documented in-code:
- Cookie + `sameSite: none`: WebKit ITP and LINE WKWebView block cross-subdomain cookies (confirmed 401 in Cloud Run logs)
- URL fragment: LINE WKWebView strips `#hash` during 302 cross-origin redirect
- URL query param: reliable, but briefly visible in server access logs

Removes the `GET /line-oa/line-login/id-token` endpoint entirely. Frontend reads `id_token` from `searchParams` and immediately clears the URL via `window.history.replaceState()`.

### Issues Found

**Critical**: None

**Warning (1)**:
- `W-01` — `apps/api/src/modules/line-oa/line-login.controller.ts`  
  **LINE ID token exposed in URL query param** → appears in GCP Cloud Run access logs and browser history before cleanup. The token is a LINE JWT valid for 5 minutes. Risk is mitigated by: (a) one-shot use, (b) frontend clears URL immediately after read, (c) token stored in-memory only. Author has documented the tradeoff explicitly. **Recommend confirming log retention and verifying `replaceState` runs before any navigation event in slow networks.**

**Info (1)**:
- `I-01` — This branch supersedes `fix/line-login-cookie-samesite` (see Branch 3). Both should **not** be merged independently — merge `fix/line-login-token-via-hash` and then close `fix/line-login-cookie-samesite` as obsolete.

### Security Notes
- `LineLoginController` has no `@UseGuards(JwtAuthGuard)` — this is **intentional and correct**. It is an OAuth 2.0 callback endpoint that must be unauthenticated by design (the user is not yet logged in). It uses `@SkipCsrf()` appropriately.
- The removed `GET /id-token` endpoint was also correctly public and its removal reduces attack surface.
- No `Number()` on financial fields, no missing `deletedAt: null` guards, no hardcoded secrets.

### Recommendation: 🔍 REVIEW

Approve with awareness of W-01. Confirm log retention policy for GCP Cloud Run access logs (or add log exclusion filter for `id_token=` URL pattern if strict PDPA compliance is required).

---

## Branch 3: `fix/line-login-cookie-samesite`

**Author**: Akenarin Kongdach  
**Last commit**: `a68f97b9` — fix(line-login): cookie sameSite=none ให้ XHR cross-subdomain ทำงาน  
**Committed**: 2026-04-22

### Files Changed
| File | Changes |
|------|---------|
| `apps/api/src/modules/line-oa/line-login.controller.ts` | +9 / −3 |

### Change Summary
Changes the `line_id_token` cookie from `sameSite: 'lax'` to `sameSite: 'none'` (requires `secure: true`), extends `maxAge` from 60s to 300s, and always sets `secure: true`. Intended to fix WebKit/LINE WKWebView blocking XHR cookie in cross-subdomain calls.

### Issues Found

**Critical**: None

**Warning (1)**:
- `W-01` — **Superseded branch**: `fix/line-login-token-via-hash` (Branch 2) was committed after this branch and completely removes the cookie-based approach. If Branch 2 is merged first, this branch's changes become a no-op (the cookie code no longer exists). If this branch is merged first, Branch 2 will cleanly overwrite it. **The two branches should not both be merged** — Branch 2 is the definitive fix.

**Info (1)**:
- `I-01` — The `sameSite: 'none'` change is technically correct (required when `secure: true`), so the fix itself is not wrong — it's simply an intermediate step that Branch 2 obsoletes.

### Recommendation: 🔍 REVIEW → CLOSE AS SUPERSEDED

This branch should be **closed/abandoned** after `fix/line-login-token-via-hash` is merged. No value in merging it independently.

---

## Summary Table

| Branch | Files | Critical | Warning | Info | Recommendation |
|--------|-------|----------|---------|------|----------------|
| `fix/liff-skip-root-rewrite` | 1 | 0 | 0 | 0 | ✅ APPROVE |
| `fix/line-login-token-via-hash` | 2 | 0 | 1 | 1 | 🔍 REVIEW |
| `fix/line-login-cookie-samesite` | 1 | 0 | 1 | 1 | 🔍 REVIEW → CLOSE |

## Merge Order Recommendation
1. Merge `fix/line-login-token-via-hash` (definitive query-param fix)
2. Close `fix/line-login-cookie-samesite` as superseded (do not merge)
3. Merge `fix/liff-skip-root-rewrite` (independent, no conflict)
