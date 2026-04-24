# Merge Guard Report — fix/line-login-cookie-samesite

**Date**: 2026-04-24  
**Branch**: `fix/line-login-cookie-samesite`  
**Open PR**: None  
**Author**: Akenarin Kongdach  
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

| File | Insertions | Deletions |
|------|-----------|-----------|
| `apps/api/src/modules/line-oa/line-login.controller.ts` | +9 | -3 |

**Total**: 1 file, 12 lines changed

---

## Change Description

Changes the `line_id_token` cookie from `sameSite: 'lax'` to `sameSite: 'none'` and extends
`maxAge` from 60 s to 300 s (5 min). The stated reason: LINE WKWebView / WebKit ITP blocks
XHR with `sameSite=lax` cookies in cross-subdomain requests
(`bestchoicephone.app → api.bestchoicephone.app`).

---

## Issues Found

### Critical
_None_

### Warning

**W-1 — Branch is superseded by `fix/line-login-token-via-hash`**

This branch represents an **intermediate** approach that was subsequently abandoned. The
`fix/line-login-token-via-hash` branch (also unmerged) goes further:
- Removes the cookie entirely
- Removes the `/id-token` one-shot endpoint
- Passes the token via query param instead

If `fix/line-login-token-via-hash` is merged, this branch becomes a no-op (its commit is
already included in that branch as `0a0bdc14`). Merging this branch first and then merging
`fix/line-login-token-via-hash` is harmless but creates unnecessary merge noise.

**W-2 — `sameSite: 'none'` requires `secure: true` in all environments**  
The change correctly sets `secure: true` unconditionally (previously conditional on
`NODE_ENV === 'production'`). Without `secure: true`, `sameSite: 'none'` is silently
downgraded to `sameSite: 'strict'` in modern browsers, breaking the intended behavior in
local dev. The fix is correct.

### Info

**I-1 — `LineLoginController` not in `security.md` public endpoint list**  
Same pre-existing note as in the `fix/line-login-token-via-hash` report.

---

## Recommendation

**🚫 BLOCK (superseded)**

Do **not** merge this branch standalone. It is entirely contained within
`fix/line-login-token-via-hash` (as commit `0a0bdc14`). Merging the token-via-hash branch
renders this branch obsolete.

**Action**: Close this branch / delete after `fix/line-login-token-via-hash` merges.
