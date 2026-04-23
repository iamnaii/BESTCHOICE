# Merge Guard Report: fix/line-login-cookie-samesite

**Date**: 2026-04-23  
**Branch**: `fix/line-login-cookie-samesite`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Last Commit**: 2026-04-22 19:44:06 +0700  
**Reviewed By**: Pre-Merge Guard Agent  

---

## File Changes Summary

| File | +/- | Description |
|------|-----|-------------|
| `apps/api/src/modules/line-oa/line-login.controller.ts` | +9 / -3 | Change `sameSite: lax → none`, `secure: conditional → true`, extend `maxAge: 60s → 300s` |

**Total**: 1 file changed, 9 insertions, 3 deletions

---

## Change Description

Attempts to fix LINE `id_token` cookie delivery failing in WebKit/LINE WKWebView by:
- Changing `sameSite` from `'lax'` to `'none'` — required for cross-origin XHR to send cookies
- Setting `secure: true` unconditionally — required when `sameSite: 'none'`
- Extending `maxAge` from 60 seconds to 300 seconds — buffer for slow LINE WebView networks

---

## Issues Found

### Critical

**C-001: Branch is superseded — merging would cause conflicts or regress a newer fix**  
- **Detail**: Branch `fix/line-login-token-via-hash` (committed 40 minutes later, 2026-04-22 20:20) completely removes the cookie mechanism this branch patches. If `fix/line-login-cookie-samesite` merges into `main` after `fix/line-login-token-via-hash`, it will reintroduce deleted code and re-add the failing cookie approach.
- **Root cause**: The `sameSite: none` change in this branch does NOT solve the actual issue — WebKit ITP blocks cross-subdomain cookies entirely regardless of `sameSite` setting (confirmed by 401s in Cloud Run logs). The subsequent branch correctly abandoned the cookie approach.
- **Action**: **Do not merge.** Close this branch as superseded by `fix/line-login-token-via-hash`.

### Warning
_None (in isolation the `sameSite: none` + `secure: true` pairing is correct)_

### Info
_None_

---

## Recommendation: 🚫 BLOCK

**Do not merge.** This branch is an intermediate attempt that was superseded 40 minutes after its commit by `fix/line-login-token-via-hash`, which takes a fundamentally different (and correct) approach. Merging this branch would reintroduce a known-broken mechanism.

**Action**: Close this branch. Merge `fix/line-login-token-via-hash` instead.
