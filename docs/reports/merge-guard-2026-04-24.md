# Pre-Merge Guard Report — 2026-04-24

**Reviewed by**: Pre-Merge Guard Agent  
**Date**: 2026-04-24  
**Branches reviewed**: 3 (most recently updated, ahead of `origin/main`)

---

## Summary

| Branch | Files Changed | Commits | Recommendation |
|--------|--------------|---------|---------------|
| `fix/liff-skip-root-rewrite` | 1 | 1 | ✅ APPROVE |
| `fix/pdf-preview-modal` | 4 | 2 | ⚠️ REVIEW |
| `fix/line-login-token-via-hash` | 2 | 2 | ⚠️ REVIEW |

---

## Branch 1: `fix/liff-skip-root-rewrite`

**Author**: Akenarin Kongdach  
**Commit**: `fix(liff): skip liff.state rewrite when state is "/" (bare rich-menu URI)`  
**Files**: `apps/web/src/main.tsx` (+4/-4)

### Change Summary
Guard the LIFF `liff.state` redirect rewrite to skip when the state value is `"/"`. Previously, a bare rich-menu URI (e.g. `https://liff.line.me/<id>/`) would set `liff.state="/"` and cause the rewrite to replace a valid LIFF endpoint pathname with `"/"`, landing users on `ProtectedRoute` instead of the intended LIFF page.

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

Clean, minimal, focused fix. The guard condition is correct and the comment explains the why clearly.

---

## Branch 2: `fix/pdf-preview-modal`

**Author**: Akenarin Kongdach  
**Commits**:
1. `feat(contract-docs): PDF preview ใน modal (แทน new tab)`
2. `fix(contract-docs): เอา DOWN_PAYMENT_RECEIPT + PDPA_CONSENT ออกจาก required`

**Files**:
- `apps/api/src/modules/contracts/contract-document.service.ts` (+1/-1)
- `apps/api/src/modules/contracts/contract-documents.service.ts` (+4/-2)
- `apps/api/src/utils/validation.util.ts` (+5/-2)
- `apps/web/src/components/contract/DocumentUpload.tsx` (+61/-42)

### Change Summary

**Part 1 — PDF modal**: Replaces `viewingDoc: ContractDocument | null` state with `viewingFile: { url, name, label? } | null`. Removes the complex `window.open()` / base64-decode / blob URL flow and instead shows all documents in an in-page modal (image or `<iframe>`). Adds a Download button. Converts the statement bank-link from `<a href target="_blank">` to a `<button>` that opens the same modal.

**Part 2 — Required docs**: Removes `DOWN_PAYMENT_RECEIPT` and `PDPA_CONSENT` from the required-documents checklists in three places:
- `contract-document.service.ts` (stats counter)
- `contract-documents.service.ts` (UI checklist)
- `validation.util.ts` (shared utility)

Comments explain: PDPA_CONSENT is auto-generated post e-signature; DOWN_PAYMENT_RECEIPT is recorded via POS, not uploaded.

### Issues Found

#### Warning — Inconsistency in `REQUIRED_DOCS` between services

`contract-document.service.ts` retains `DEVICE_IMEI_PHOTO` in its `REQUIRED_DOCS` array (4 items), while `contract-documents.service.ts` and `validation.util.ts` only list 4 types that include `SIGNED_CONTRACT` but exclude `DEVICE_IMEI_PHOTO`. This pre-existing drift means the "pending documents" counter in `contract-document.service.ts` uses a stricter check than the UI checklist and the shared validation utility.

**Risk**: A contract could show as "fully documented" in the UI checklist but still be counted as `pendingDocuments` in the dashboard stats (or vice versa), causing incorrect KPI figures.

> **Note**: This inconsistency exists in `origin/main` before this PR — the PR does not introduce it — but it is surfaced/highlighted here because the PR touches all three files and is a natural opportunity to align them.

#### Info — Modal uses `bg-black/70` overlay

`bg-black/70` is a Tailwind opacity utility (not a hardcoded hex), but the design-token rule discourages direct use of color utilities. The existing codebase uses `bg-black/60` in other modals (also in this same file for thumbnail overlay), so it is consistent practice here. No action required.

#### Info — No `queryClient.invalidateQueries()` needed

The PR only touches the preview modal state (local UI state). No mutations or cache paths are affected. Verified: no missing invalidation.

### Recommendation: ⚠️ REVIEW

The code quality and logic are sound. Merge is safe. However, consider aligning `DEVICE_IMEI_PHOTO` presence across all three required-docs lists in a follow-up to fix the pre-existing KPI drift.

---

## Branch 3: `fix/line-login-token-via-hash`

**Author**: Akenarin Kongdach  
**Commits**:
1. `fix(line-login): ส่ง id_token ผ่าน URL fragment แทน cookie`
2. `fix(line-login): ส่ง id_token ผ่าน query param (แทน hash ที่ WebView strip)`

**Files**:
- `apps/api/src/modules/line-oa/line-login.controller.ts` (+14/-51)
- `apps/web/src/hooks/useLiffInit.ts` (+8/-20)

### Change Summary

Replaces the cookie-based `id_token` handoff (httpOnly cookie → one-shot `/id-token` XHR endpoint) with a direct URL query parameter. The rationale (documented in code comments):
- **Cookie**: WebKit ITP + LINE WKWebView block cross-subdomain `sameSite=none` cookies even with `COOKIE_DOMAIN` set — confirmed 401s in Cloud Run logs.
- **Fragment**: LINE WKWebView strips hash during cross-origin 302 redirects — confirmed token loss.
- **Query param**: Reliable in all environments; acknowledged tradeoff is token appearing in server access logs and browser history for the token's 5-minute lifetime. Frontend clears the URL immediately after reading.

The `/id-token` one-shot endpoint is removed entirely (net security surface reduction: −1 public endpoint).

`useLiffInit.ts` updated to read `id_token` from `params.get('id_token')` with a hash fallback for backward compat, then scrubs it from `window.location` immediately.

### Issues Found

#### Warning — `id_token` appears in server access logs

LINE `id_token` is a credential/PII adjacent value. Sending it as a query parameter means it will appear in:
- Cloud Run / nginx access logs (`GET /line-oa/line-login/callback?...&id_token=<token>`)
- Browser history before `history.replaceState` runs
- Potentially `Referer` headers if the frontend loads any third-party resources before clearing the URL

The code comment acknowledges this and judges it acceptable given the 5-minute TTL and immediate URL cleanup. This assessment is defensible for the current threat model, but it conflicts with the security rule:
> **ห้าม log tokens, passwords, หรือ PII**

**Recommendation**: Ensure Cloud Run / load-balancer access logs are either: (a) filtered to redact `id_token` query parameters, or (b) treated with the same retention/access controls as PII. This is an ops-level follow-up, not a blocker.

#### Warning — `LineLoginController` not listed as intentionally public

`line-login.controller.ts` has no `@UseGuards(JwtAuthGuard)` (only `@SkipCsrf()`). The two endpoints (`/authorize`, `/callback`) are correctly public by nature of OAuth flow, but the controller is **not listed** in `.claude/rules/security.md` under "Intentionally Public Endpoints."

**Impact**: Low (the endpoints are correctly public for OAuth), but the omission means any future audit or the Pre-Merge Guard will flag it repeatedly.

**Recommendation**: Add `line-oa/line-login` to the intentionally-public list in `security.md` with a note that it uses LINE OAuth as the auth mechanism.

#### Info — Removed `/id-token` endpoint (net positive)

The one-shot `/id-token` endpoint that was also public (no JWT guard) is removed. This reduces the public attack surface. No concerns.

### Recommendation: ⚠️ REVIEW

The change is technically correct and the tradeoffs are documented. Two non-blocking follow-ups:
1. Redact `id_token` from server access logs (ops task).
2. Add `line-oa/line-login` to `security.md` intentionally-public list.

---

## Overall Status

| Issue | Severity | Branch | Action |
|-------|----------|--------|--------|
| `id_token` in server access logs | Warning | `fix/line-login-token-via-hash` | Ops: redact from Cloud Run logs |
| `LineLoginController` not in intentionally-public list | Warning | `fix/line-login-token-via-hash` | Update `security.md` |
| `DEVICE_IMEI_PHOTO` missing from `contract-documents.service.ts` + `validation.util.ts` REQUIRED_DOCS | Warning | `fix/pdf-preview-modal` | Follow-up ticket to align lists |

**No Critical blockers found across all 3 branches.**

All branches are safe to merge. The two REVIEW branches have warning-level findings that are either pre-existing or have documented justifications, but each has a concrete follow-up action recommended.
