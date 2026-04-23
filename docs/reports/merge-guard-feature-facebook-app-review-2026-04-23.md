# Merge Guard Report — feature/facebook-app-review

**Date**: 2026-04-23  
**Branch**: `feature/facebook-app-review`  
**Author**: Akenarin Kongdach  
**Commits**:
- `148b2f8` — feat(facebook-app-review): UI panel in Integration Hub for permission tests
- `3752674` — feat(facebook-app-review): module for App Review permission testing

---

## File Changes Summary

| File | Lines | Type |
|------|-------|------|
| `apps/api/src/app.module.ts` | +4 | Module registration |
| `apps/api/src/modules/facebook-app-review/dto/facebook-app-review.dto.ts` | +82 | New — DTOs |
| `apps/api/src/modules/facebook-app-review/facebook-app-review.controller.ts` | +92 | New — Controller |
| `apps/api/src/modules/facebook-app-review/facebook-app-review.module.ts` | +17 | New — Module |
| `apps/api/src/modules/facebook-app-review/facebook-app-review.service.ts` | +279 | New — Service |
| `apps/web/src/components/FacebookAppReviewPanel.tsx` | +390 | New — React component |
| `apps/web/src/pages/IntegrationHubPage.tsx` | +4 | Adds panel to Facebook config drawer |
| `docs/guides/FACEBOOK-APP-REVIEW.md` | +160 | New — Runbook |

**Total**: 8 files, ~1,027 insertions — new admin-only module.

---

## Issues by Severity

### Critical
_None_

### Warning

**W-1: FB access tokens embedded in GET request URLs (server-side)**  
File: `apps/api/src/modules/facebook-app-review/facebook-app-review.service.ts`

Several methods construct URLs with `access_token=` in the query string:
```ts
// line ~313
const url = `${GRAPH_BASE}/me/accounts?fields=id,name,...&access_token=${token}`;

// line ~351
const url = `${GRAPH_BASE}/${this.pageId}/promotable_posts?...&access_token=${this.pageToken}`;

// line ~409
const url = `${GRAPH_BASE}/${formId}/leads?access_token=${this.pageToken}`;
```

The `call()` helper redacts these before logging (`url.replace(/access_token=[^&]+/g, 'access_token=***')`), so **application logs are safe**. However:
- Cloud Run / nginx access logs log the outbound URL **before** the application sees it, potentially capturing the raw token
- If any proxy or CDN sits between the API and graph.facebook.com, the token appears in its logs

**Mitigation**: For POST requests, move `access_token` from URL to the `Authorization: Bearer <token>` header or to the POST body exclusively. For GET requests, use `Authorization: Bearer` header instead.

```ts
// Preferred pattern (Authorization header):
const res = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` },
  signal: AbortSignal.timeout(TIMEOUT_MS),
});
```

Facebook's Graph API supports Bearer token auth on all endpoints. This eliminates the token from URL query strings entirely.

**Action**: Refactor `call()` to accept a token parameter and pass it via `Authorization` header for GET requests.

**W-2: `dailyBudget` uses `number` type in DTO (Meta Ads budget)**  
File: `apps/api/src/modules/facebook-app-review/dto/facebook-app-review.dto.ts:65`

```ts
@IsNumber({}, { message: 'daily budget ต้องเป็นตัวเลข (บาท)' })
dailyBudget?: number;
```

This is for the Facebook Ad API budget (external), not an internal financial field, so `number` is acceptable here. The service converts correctly (`Math.round(dto.dailyBudget * 100)` before sending to Meta). Not a concern per database rules — **no Prisma involvement**.

### Info

**I-1: `FacebookAppReviewPanel.tsx` is 390 lines**  
Borderline large but the file is cohesive — it defines constants, two component types, and a container. Could be split into `TestRow` + panel if it grows further. No action required now.

**I-2: No `queryClient.invalidateQueries()` in mutations**  
File: `apps/web/src/components/FacebookAppReviewPanel.tsx:700`

The mutations are fire-and-forget admin test actions — no cached query state is invalidated after them. This is intentional and correct since there's no related `useQuery` cache to invalidate.

**I-3: Inline `fetch` in service uses Node 18+ `AbortSignal.timeout()`**  
File: `apps/api/src/modules/facebook-app-review/facebook-app-review.service.ts:488`

`AbortSignal.timeout()` requires Node 17.3+. BESTCHOICE already uses Node 18+ (Cloud Run), so this is safe. Info only.

---

## Security Checklist

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on controller class | ✅ Present (`line 147`) |
| `@Roles()` on every method | ✅ All 9 methods have `@Roles('OWNER')` |
| DTO class-validator decorators | ✅ All fields validated with Thai messages |
| `Number()` on money/financial fields | ✅ None — no Prisma/DB involvement |
| `deletedAt: null` in queries | ✅ N/A — no Prisma queries |
| Hardcoded secrets | ✅ None — uses `ConfigService` |
| SQL injection | ✅ N/A — no raw queries |
| Frontend uses `api.get/post/patch` | ✅ Not raw `fetch()` |

---

## Analysis

The module is an admin-only feature (OWNER role only) with correct guards, proper DTOs, and good error handling with Sentry integration. The core logic is straightforward Graph API wrappers with timeout protection and error propagation.

The main concern (W-1) is the FB access token appearing in URL query strings for server-to-server Graph API calls. While Facebook officially supports this pattern, moving to `Authorization: Bearer` headers is more secure and eliminates any risk from proxy/CDN log leakage. This is a should-fix rather than a blocker given the module is OWNER-only and the tokens are server-side.

---

## Recommendation

**REVIEW** ⚠️

No blocking issues. Recommend addressing W-1 (move FB access tokens from URL query params to `Authorization: Bearer` header) before or shortly after merge. The feature is otherwise well-implemented, correctly guarded, and ready for production use.

**Suggested fix for W-1** — update `call()` helper to accept optional token:
```ts
private async call(
  method: 'GET' | 'POST',
  url: string,
  body: unknown,
  action: string,
  token?: string,   // <-- add
): Promise<FbJson> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {          // url no longer has access_token=
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // ...
}
```
