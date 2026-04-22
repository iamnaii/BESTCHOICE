# Pre-Merge Guard Report — 2026-04-22

**Reviewed by**: Pre-Merge Guard (automated)
**Date**: 2026-04-22
**Branches reviewed**: 3 most-recently-committed feature/fix branches

---

## Branch 1: `fix/liff-skip-root-rewrite`

**Author**: Akenarin Kongdach  
**Date**: 2026-04-23  
**Commit**: `0ab6151d fix(liff): skip liff.state rewrite when state is "/" (bare rich-menu URI)`

### File Changes
| File | Changes |
|------|---------|
| `apps/web/src/main.tsx` | +4 / -4 (comment update + guard condition) |

### Diff Summary
Adds `&& liffState !== '/'` to the pre-React LIFF URL rewrite block.
Without the fix, a bare rich-menu URI (LIFF endpoint with no sub-path) causes
`window.history.replaceState` to rewrite the current path to `"/"`, which
causes the LIFF page to hit `ProtectedRoute` and redirect to `/login`.

### Issues Found
_None._

### Recommendation: ✅ APPROVE

---

## Branch 2: `fix/line-login-token-via-hash`

**Author**: Akenarin Kongdach  
**Date**: 2026-04-22  
**Commits**:
- `85a2cefb fix(line-login): ส่ง id_token ผ่าน query param (แทน hash ที่ WebView strip)`
- `7c96ecbb fix(line-login): ส่ง id_token ผ่าน URL fragment แทน cookie`

### File Changes
| File | Changes |
|------|---------|
| `apps/api/src/modules/line-oa/line-login.controller.ts` | +14 / -38 |
| `apps/web/src/hooks/useLiffInit.ts` | +12 / -27 |

### Diff Summary
- **Removes** the `httpOnly` cookie approach for passing the LINE ID token (`line_id_token`
  cookie set in `/callback` → fetched via one-shot `/id-token` GET endpoint).
- **Removes** the intermediate `/id-token` GET endpoint entirely.
- **Adds** `id_token` as a URL query parameter in the `/callback` redirect.
- Frontend now reads `id_token` from `params.get('id_token')` (with hash fallback for
  backward compat), then immediately clears the URL.

The commit comments document why prior approaches failed:
- Cookie: WebKit ITP + LINE WKWebView block cross-subdomain cookies (`sameSite=none`
  confirmed broken in Cloud Run logs)
- URL fragment (hash): LINE WKWebView strips hash across cross-origin 302 redirects

### Issues Found

#### ⚠️ WARNING — ID Token Exposed in URL Query Parameter

| | |
|---|---|
| **File** | `apps/api/src/modules/line-oa/line-login.controller.ts:144` |
| **Field** | `redirectUrl.searchParams.set('id_token', tokenData.id_token)` |
| **Risk** | LINE ID token (a signed JWT credential) is visible in GCP access logs, browser history, and Referrer headers sent to any third-party script loaded on the landing page. |

**Developer rationale (from commit comments)**: Intentional last-resort after cookie
and hash approaches both failed in production. Risk is accepted with the following
mitigations:
- 5-minute token TTL (one-shot use)
- Frontend clears URL immediately after reading via `window.history.replaceState`
- Token kept in-memory only after read (not localStorage/cookie)

**Recommendation**: Accepted as a pragmatic trade-off, but document the access-log
leak risk in the runbook. Consider adding `id_token` to the PII webhook log
allow-list review (analogous to the PII log masking done in v3 hardening).
If LINE's API supports short-lived PKCE-style exchange codes in the future,
migrate away from this approach.

#### ℹ️ INFO — `LineLoginController` Not Listed in Intentionally-Public Endpoint Registry

| | |
|---|---|
| **File** | `apps/api/src/modules/line-oa/line-login.controller.ts` |
| **Rule** | `.claude/rules/security.md` — Intentionally Public Endpoints list |

`@Controller('line-oa/line-login')` has no `@UseGuards(JwtAuthGuard)` and is decorated
with `@SkipCsrf()`. This is architecturally correct (OAuth callbacks must be public),
but the controller path is not listed in the project's intentionally-public registry.

**Action**: Add `line-oa/line-login` to the intentionally-public list in
`.claude/rules/security.md` to prevent future guard-audit false positives.

### Recommendation: 🔶 REVIEW
Merge is acceptable. Address the Info item (update security.md registry) before or
alongside the merge. The Warning is documented and accepted by the author.

---

## Branch 3: `fix/verification-spec-mock`

**Author**: Akenarin Kongdach  
**Date**: 2026-04-22  
**Commit**: `e4fbf74f fix(test): add customer.update to tx mock in verification.spec`

### File Changes
| File | Changes |
|------|---------|
| `apps/api/src/modules/chatbot-finance/services/verification.service.spec.ts` | +1 / -0 |

### Diff Summary
Adds `customer: { update: jest.fn().mockResolvedValue({}) }` to the Prisma transaction
mock in `VerificationService` tests. Without this, `verification.service.spec.ts` would
throw `TypeError: tx.customer.update is not a function` when the service calls
`customer.update` inside the `$transaction` callback.

### Issues Found
_None._ Test-only change; no production code modified.

### Recommendation: ✅ APPROVE

---

## Summary Table

| Branch | Files Changed | Critical | Warning | Info | Recommendation |
|--------|--------------|----------|---------|------|----------------|
| `fix/liff-skip-root-rewrite` | 1 | 0 | 0 | 0 | ✅ APPROVE |
| `fix/line-login-token-via-hash` | 2 | 0 | 1 | 1 | 🔶 REVIEW |
| `fix/verification-spec-mock` | 1 | 0 | 0 | 0 | ✅ APPROVE |

### Action Items
1. **`fix/line-login-token-via-hash`** — Add `line-oa/line-login` to the intentionally-public
   endpoint list in `.claude/rules/security.md` before merge.
2. **`fix/line-login-token-via-hash`** — Add a note in the access-log / PII runbook that
   `id_token` appears in LINE Login redirect URLs (short-lived, intentional).
