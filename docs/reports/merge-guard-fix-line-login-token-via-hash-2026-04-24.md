# Merge Guard Report — fix/line-login-token-via-hash

**Date**: 2026-04-24  
**Branch**: `fix/line-login-token-via-hash`  
**Open PR**: None (branch active, no PR opened yet)  
**Author**: Akenarin Kongdach  
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

| File | Insertions | Deletions |
|------|-----------|-----------|
| `apps/api/src/modules/line-oa/line-login.controller.ts` | +14 | -52 |
| `apps/web/src/hooks/useLiffInit.ts` | +8 | -20 |

**Total**: 2 files, 78 lines changed (net -50 — significant cleanup)

---

## Change Description

This branch went through 3 iterations on top of `origin/main`:

1. **commit `0a0bdc14`** — `sameSite=none` on `line_id_token` cookie (to fix LINE WKWebView XHR block)
2. **commit `7c96ecbb`** — Abandoned cookie approach; moved token to URL **hash fragment**
3. **commit `85a2cefb`** — Abandoned hash approach; moved token to URL **query param** (final state)

**Final approach**: Backend `/callback` now passes `id_token` directly in the redirect URL as
`?id_token=<jwt>`. Frontend `useLiffInit.ts` reads the param, immediately clears it from the URL
via `window.history.replaceState`, and keeps the token in JS memory only.

The `GET /line-oa/line-login/id-token` one-shot cookie endpoint was **removed** entirely.

---

## Issues Found

### Critical
_None_

### Warning

**W-1 — ID token exposed in query parameter (security tradeoff)**  
**File**: `apps/api/src/modules/line-oa/line-login.controller.ts`

The LINE ID token (a signed JWT containing userId, displayName, pictureUrl) is passed as
`?id_token=<jwt>` in the OAuth redirect URL. This means the token briefly appears in:
- Browser history (for the redirect target URL)
- CDN/web-server access logs for the frontend origin
- HTTP `Referer` headers if any subresource is loaded before `replaceState` fires

**Mitigations present in the code**:
- `window.history.replaceState` clears the URL immediately on component mount
- Token is a one-shot 5-minute JWT (not a long-lived credential)
- Token is kept in JS memory only (not localStorage/cookie) after reading
- Code comment explicitly documents the tradeoff and why cookie/hash approaches failed

**Assessment**: Acceptable tradeoff given LINE WKWebView constraints (confirmed in Cloud Run
logs per commit message). The comment in the code documents the rationale thoroughly. Risk is
low given the 5-min TTL and immediate URL cleanup. No action strictly required but worth
noting for a future PII audit.

---

**W-2 — `LineLoginController` not in `security.md` intentionally-public list**  
**File**: `apps/api/src/modules/line-oa/line-login.controller.ts`

The controller has no `@UseGuards(JwtAuthGuard, RolesGuard)` — correct for an OAuth callback
(users are unauthenticated when LINE redirects back). However, per `security.md`:

> "ถ้าพบ controller ที่ไม่มี guard ที่ไม่อยู่ในรายการนี้ → ถือว่าเป็น security bug"

This is a **pre-existing condition** (the controller was not introduced by this branch) but it
should be documented. Recommend adding `line-oa/line-login` to the intentionally-public list
in `.claude/rules/security.md`.

---

### Info

**I-1 — Removed raw `fetch()` call (positive change)**  
`useLiffInit.ts` previously used `fetch()` with `credentials: 'include'` to hit the cookie
endpoint. This PR removes that raw `fetch()`, which was a violation of the frontend rules
(`ห้ามใช้ raw fetch()`). Net improvement.

**I-2 — Backward-compat fallback for hash token**  
```ts
const lineIdToken =
  params.get('id_token') ||
  new URLSearchParams(window.location.hash.slice(1)).get('id_token');
```
The `|| hash fallback` guards against older backend revisions still using the fragment
approach. Safe and self-documenting. Can be removed once all environments are on the new
backend.

---

## Recommendation

**🔍 REVIEW**

No blocking issues. Security tradeoff (W-1) is documented in code and acceptable given
confirmed WKWebView constraints. Before merging:

1. Add `line-oa/line-login` (OAuth callback, no JWT guard) to the intentional-public list
   in `.claude/rules/security.md` to satisfy the security audit rule.
2. Confirm E2E test on real LINE WKWebView (Cloud Run staging) before merge to production.
3. Note: `fix/line-login-cookie-samesite` branch is superseded — close it after this merges.
