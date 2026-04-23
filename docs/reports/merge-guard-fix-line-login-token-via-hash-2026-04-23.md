# Merge Guard Report — fix/line-login-token-via-hash

**Date**: 2026-04-23  
**Branch**: `fix/line-login-token-via-hash`  
**Author**: Akenarin Kongdach  
**Commits**: `85a2cefb`, `7c96ecbb`  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

| File | Changes |
|------|---------|
| `apps/api/src/modules/line-oa/line-login.controller.ts` | +14 / -47 |
| `apps/web/src/hooks/useLiffInit.ts` | +6 / -22 |

**Total**: 2 files, 20 insertions, 58 deletions (net -38 lines)

---

## What Changed

Replaces the three-step cookie-based id_token handoff (callback → set httpOnly cookie → frontend calls `/id-token` endpoint) with a simpler one-step approach: callback appends `id_token` as a URL query parameter in the `302` redirect to the frontend. The frontend reads it directly from `window.location.search`, stores in memory, and immediately cleans the URL via `window.history.replaceState`.

Motivation (documented in code comments): WebKit ITP + LINE WKWebView block cross-subdomain `sameSite=none` cookies, and `sameSite=lax` cookies fail in XHR cross-origin within the same site. Fragment (`#`) also got stripped by LINE WKWebView on cross-origin redirects. URL query param is the only reliable channel in this environment.

The `/id-token` one-shot endpoint is removed entirely, reducing the API surface.

---

## Issues Found

### Critical
_None._

### Warning

**W-1 — LINE `id_token` exposed in URL query parameter**  
`apps/api/src/modules/line-oa/line-login.controller.ts` (line ~148)

```typescript
redirectUrl.searchParams.set('id_token', tokenData.id_token);
```

The LINE ID token now appears in:
- Server access logs (Cloud Run / nginx) for the `302` redirect URL
- Browser history entry (before `replaceState` executes)
- `Referer` header if the user navigates away before React mounts

Mitigating factors (explicitly acknowledged in code comment):
- Token is a LINE-issued JWT, valid for ~5 minutes (maxAge comment says 300s)
- Frontend calls `window.history.replaceState` immediately on mount, before any navigation
- Token is kept in-memory after reading — not persisted

**Action required**: Confirm with the team that server access-log exposure of short-lived LINE tokens is acceptable, and consider adding an access-log filter/mask for the `id_token` parameter on Cloud Run if sensitivity requires it.

**W-2 — `LineLoginController` not listed in documented intentionally-public exceptions**  
`apps/api/src/modules/line-oa/line-login.controller.ts` (class level)

The controller has no `@UseGuards(JwtAuthGuard)` and is not present in `.claude/rules/security.md`'s `## Intentionally Public Endpoints` list. This is a pre-existing condition (the controller was already unguarded before this PR), but the rule states:

> ถ้าพบ controller ที่ไม่มี guard ที่ไม่อยู่ในรายการนี้ → ถือว่าเป็น security bug

LINE OAuth callbacks (`/authorize`, `/callback`) **must** be public by design — JWT authentication is impossible at this step since the user has not yet authenticated. The fix for this warning is a one-line documentation update in `security.md`, not a code change.

**Action required**: Add `line-oa/line-login` to the intentionally-public exceptions list in `.claude/rules/security.md` with a note explaining it is the LINE OAuth 2.0 callback handler.

### Info

**I-1 — Raw `fetch()` removed (positive)**  
The old `useLiffInit.ts` contained a raw `fetch()` call to the `/id-token` endpoint (violating the frontend rule "ห้ามใช้ raw fetch()"). This PR removes that call entirely. Net improvement.

---

## Notes

- No financial fields touched; no Decimal/Number concerns.
- No new Prisma queries; no `deletedAt` concern.
- No new DTOs introduced.
- Net line count is negative (code simplified).
- Both warnings are documentation/process gaps, not logic bugs. W-2 in particular is pre-existing and unrelated to the fix itself.
