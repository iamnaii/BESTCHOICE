# Merge Guard Report: fix/line-login-token-via-hash

**Date**: 2026-04-23  
**Branch**: `fix/line-login-token-via-hash`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Last Commit**: 2026-04-22 20:20:31 +0700  
**Reviewed By**: Pre-Merge Guard Agent  

---

## File Changes Summary

| File | +/- | Description |
|------|-----|-------------|
| `apps/api/src/modules/line-oa/line-login.controller.ts` | +14 / -31 | Remove cookie approach; pass `id_token` as URL query param; remove `/id-token` one-shot endpoint |
| `apps/web/src/hooks/useLiffInit.ts` | +11 / -21 | Read `id_token` from URL query param (with hash fallback); remove `fetch` call to `/id-token` endpoint |

**Total**: 2 files changed, 20 insertions, 58 deletions (net simplification)

---

## Change Description

The previous implementation stored the LINE `id_token` in an `httpOnly` cookie (`line_id_token`) after the OAuth callback, then the frontend fetched it via a dedicated `/id-token` one-shot endpoint. This 3-step cookie approach failed on production because:

- **WebKit ITP** (Safari / LINE in-app WKWebView) blocks cross-subdomain cookies even with `sameSite=none` — confirmed by 401 errors in Cloud Run logs
- Branch `fix/line-login-cookie-samesite` attempted to fix this with `sameSite: 'none'` but the root cause is ITP, not `sameSite`

This branch replaces the cookie flow with a **direct query param approach**: the OAuth callback appends `id_token=<jwt>` to the redirect URL; the frontend reads it immediately, clears it from the URL, and keeps it in-memory.

---

## Issues Found

### Critical
_None_

### Warning

**W-001: LINE `id_token` exposed in URL query parameter**  
- **File**: `apps/api/src/modules/line-oa/line-login.controller.ts:148`  
- **Detail**: The LINE ID token (a JWT) is appended to the redirect URL as `?id_token=<jwt>`. This means the token appears briefly in:
  - Server access logs (Cloud Run request logs)
  - Browser history (for the ~milliseconds before `replaceState` clears it)
  - HTTP Referrer header if the LIFF page fires any sub-resource request before the React hook runs
- **Mitigations already in place**:
  - Token is a one-shot LINE OAuth `id_token` (10-min expiry) — not an app JWT
  - Frontend clears the URL immediately via `window.history.replaceState` after reading
  - Token is then kept only in-memory (not localStorage)
  - Code comment explicitly acknowledges the trade-off
- **Assessment**: Acceptable given the WebKit ITP constraint. This matches LINE's own documented recommendation for WKWebView environments. Risk is low; token is short-lived and profile-scoped only (userId, displayName, pictureUrl).
- **Action**: No code change required. Recommend confirming Cloud Run log retention and access controls are tight (restrict who can read raw HTTP logs).

**W-002: `LineLoginController` not listed in security rules "Intentionally Public Endpoints"**  
- **File**: `apps/api/src/modules/line-oa/line-login.controller.ts`  
- **Detail**: The controller has no `@UseGuards(JwtAuthGuard)` and is not in the `Intentionally Public Endpoints` list in `.claude/rules/security.md`. Per the security rule: "ถ้าพบ controller ที่ไม่มี guard ที่ไม่อยู่ในรายการนี้ → ถือว่าเป็น security bug".
- **Clarification**: This is a **pre-existing condition** — the controller was not added by this branch. It is also functionally correct to be public: it is a LINE OAuth callback receiver and MUST be accessible without a JWT (LINE's servers redirect here). Adding `JwtAuthGuard` would break the OAuth flow.
- **Action**: Update `.claude/rules/security.md` to add `line-oa/line-login` to the intentionally public list with justification. This PR does not introduce the issue but it's a good time to document it.

### Info

**I-001: Backward-compatibility fallback reads `id_token` from URL fragment**  
- **File**: `apps/web/src/hooks/useLiffInit.ts:52-54`  
- **Detail**: Frontend falls back to reading `id_token` from `window.location.hash` if it's not in query params. This was never a shipped approach (branch `fix/line-login-token-via-hash` itself rejected the hash approach). The fallback is dead code on first deploy.
- **Action**: Safe to keep as defensive fallback; can be removed in a follow-up cleanup.

---

## Relationship to fix/line-login-cookie-samesite

This branch **supersedes** `fix/line-login-cookie-samesite` (committed 40 min earlier). That branch changed `sameSite: lax → none` as an intermediate fix; this branch removes the cookie mechanism entirely. **Do not merge both.** If this branch merges first, `fix/line-login-cookie-samesite` should be closed as superseded.

---

## Recommendation: 🔶 REVIEW

Merge after:
1. Confirming Cloud Run log access is restricted to ops team (W-001 mitigation)
2. Adding `line-oa/line-login` to the intentionally public endpoints list in `.claude/rules/security.md` (W-002)
3. Closing `fix/line-login-cookie-samesite` as superseded

No code changes required in this branch itself.
