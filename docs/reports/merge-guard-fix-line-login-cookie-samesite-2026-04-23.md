# Merge Guard Report — fix/line-login-cookie-samesite

**Date**: 2026-04-23
**Branch**: `fix/line-login-cookie-samesite`
**Author**: Akenarin Kongdach
**Reviewed by**: Pre-Merge Guard (automated)

---

## File Changes Summary

| File | Changes |
|------|---------|
| `apps/api/src/modules/line-oa/line-login.controller.ts` | +9 / -3 (cookie attributes only) |

**1 file changed, 9 insertions(+), 3 deletions(-)**

---

## Change Description

Updates the `line_id_token` httpOnly cookie set in `/callback` to use `sameSite: 'none'` (was `'lax'`) and extends `maxAge` from 60s → 300s.

**Rationale**: WebKit (Safari + LINE WKWebView) does not send `sameSite=lax` cookies for cross-subdomain XHR requests, even when the request is same-site. Setting `sameSite=none` (requires `secure: true`) allows the frontend's `/id-token` XHR to carry the cookie from `bestchoicephone.app → api.bestchoicephone.app`.

The change also corrects `secure` from `process.env.NODE_ENV === 'production' || !!cookieDomain` (could be `false` in staging) to always `true` — required by the browser spec when `sameSite=none`.

---

## Issues by Severity

### Critical
_None_

### Warning

**W-001 — Branch superseded by `fix/line-login-token-via-hash`**

This branch's approach (cookie + `/id-token` endpoint) was abandoned in favour of URL query param delivery after `sameSite=none` cookies were also observed failing in LINE WKWebView (confirmed via Cloud Run 401 logs). The branch `fix/line-login-token-via-hash` diverges from this branch's tip and removes the cookie mechanism entirely.

**Consequence**: If both branches are merged:
- `fix/line-login-cookie-samesite` lands first → sets `sameSite=none`
- `fix/line-login-token-via-hash` lands second → removes the entire cookie block

Net result is correct, but the intermediate state is confusing and the cookie endpoint stays alive briefly between deployments.

**Recommended action**: Do **not** merge this branch independently. Let `fix/line-login-token-via-hash` merge directly off main — it includes this fix's intent and goes further.

### Info
_None_

---

## Recommendation: 🚫 BLOCK

Not due to code quality — the change itself is correct (`sameSite=none` + `secure=true` is the right pairing). Block because this branch is **superseded by `fix/line-login-token-via-hash`**, which abandons the cookie approach entirely. Merging this branch independently serves no purpose and creates a confusing intermediate deployment state. Close in favour of the `fix/line-login-token-via-hash` branch.
