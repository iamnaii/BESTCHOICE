# Merge Guard Report — fix/line-login-token-via-hash

**Date**: 2026-04-23
**Branch**: `fix/line-login-token-via-hash`
**Author**: Akenarin Kongdach
**Reviewed by**: Pre-Merge Guard (automated)

---

## File Changes Summary

| File | Changes |
|------|---------|
| `apps/api/src/modules/line-oa/line-login.controller.ts` | +14 / -31 (removes cookie approach + `getIdToken` endpoint) |
| `apps/web/src/hooks/useLiffInit.ts` | +6 / -22 (reads id_token from query param, removes fetch()) |

**2 files changed, 20 insertions(+), 58 deletions(-)**

---

## Change Description

Replaces the three-step httpOnly-cookie mechanism (redirect → set cookie → frontend XHR to `/id-token`) with a single-step URL query parameter approach for passing the LINE `id_token` after OAuth callback.

**Previous flow**:
1. `/callback` sets `line_id_token` in httpOnly cookie (`sameSite=none`)
2. Frontend redirected to LIFF page
3. Frontend XHR-fetches `/line-oa/line-login/id-token` → backend reads cookie, clears it, returns token

**New flow**:
1. `/callback` appends `id_token=<value>` to the redirect URL query string
2. Frontend reads `id_token` from `window.location.search` immediately
3. Frontend calls `window.history.replaceState` to erase it from URL + clears hash

**Motivation**: WebKit ITP + LINE WKWebView block `sameSite=none` cookies even within same-site cross-subdomain XHR (confirmed by Cloud Run 401 logs). The intermediate hash approach was also abandoned after LINE WKWebView was observed stripping URL fragments during cross-origin 302 redirects.

---

## Issues by Severity

### Critical
_None_

### Warning

**W-001 — id_token briefly exposed in URL (access logs + browser history)**

- `id_token` is a LINE-issued JWT (identifies user: sub, displayName, pictureUrl). Passing it as a URL query parameter means it appears in:
  - Server/CDN/proxy access logs (until the 302 chain finishes)
  - Browser history (for the ~200ms before `replaceState` clears it)
  - Any `Referer` header emitted to third-party resources on the landing page before cleanup runs

- **Mitigations in place**:
  - Frontend clears the URL via `replaceState` as the first action after reading the param (before any render)
  - Token has a short effective TTL (LINE tokens expire in ~10 min; usage is immediately after redirect)
  - `id_token` scope here is LIFF user identification only — not a payment credential or JWT access token
  - Author documented the deliberate trade-off with comment explaining why cookie and hash both failed

- **Assessment**: Deliberate, documented trade-off forced by WebKit/LINE WKWebView constraints. The risk is real but low-impact (short-lived token, fast cleanup). This should be **noted in the PR description** and an access-log filter/scrub rule added for `id_token=` patterns in Cloud Run log export (if not already in place).

### Info

**I-001 — Hash fallback is reachable only from a future deploy regression**

```ts
const lineIdToken =
  params.get('id_token') ||
  new URLSearchParams(window.location.hash.slice(1)).get('id_token');
```

The hash fallback handles the intermediate commit where the backend sent `id_token` via fragment — that commit is no longer in main and will not be deployed independently. Once this branch merges, the hash path becomes permanently dead code. Consider removing it in a follow-up cleanup commit.

**I-002 — `line-login` controller not in security.md intentionally-public list (pre-existing)**

`LineLoginController` uses `@SkipCsrf()` and no `@UseGuards()` — correct for an OAuth callback. However, the controller is missing from the documented intentionally-public list in `.claude/rules/security.md`. This is a pre-existing gap, not introduced by this branch. Recommend updating `security.md` to add `line-login` to the list to prevent future guard-bot false positives.

---

## Recommendation: ⚠️ REVIEW

Functionally correct fix for a real WebKit/LINE WKWebView limitation. No Critical issues. The security trade-off (W-001) is acknowledged and mitigated, but should be explicitly stated in the PR description and paired with a log-scrubbing consideration. Recommend merging after:

1. Confirming Cloud Run log export does not retain raw query strings containing `id_token` beyond the access-log TTL, or adding a log filter.
2. Updating `security.md` to document `line-login` as intentionally public (I-002).

The hash fallback (I-001) can be cleaned up in a follow-up — it is not blocking.
