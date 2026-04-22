# Merge Guard Report — feature/facebook-app-review

**Date**: 2026-04-22  
**Branch**: `feature/facebook-app-review`  
**Author**: Akenarin Kongdach  
**Base**: `origin/main`  
**Commits**: 2

## File Changes Summary

| File | Lines +/- | Type |
|------|-----------|------|
| `apps/api/src/app.module.ts` | +2 | Module registration |
| `apps/api/src/modules/facebook-app-review/dto/facebook-app-review.dto.ts` | +82 new | DTOs |
| `apps/api/src/modules/facebook-app-review/facebook-app-review.controller.ts` | +92 new | Controller |
| `apps/api/src/modules/facebook-app-review/facebook-app-review.module.ts` | +17 new | Module |
| `apps/api/src/modules/facebook-app-review/facebook-app-review.service.ts` | +279 new | Service |
| `apps/web/src/components/FacebookAppReviewPanel.tsx` | +390 new | React component |
| `apps/web/src/pages/IntegrationHubPage.tsx` | +4 | Panel wired into Integration Hub |
| `docs/guides/FACEBOOK-APP-REVIEW.md` | +160 new | Runbook |

**Total**: 8 files, ~1,027 insertions

---

## Issues by Severity

### ✅ Critical — None Found

- `FacebookAppReviewController` has `@UseGuards(JwtAuthGuard, RolesGuard)` at class level ✓
- Every controller method has `@Roles('OWNER')` ✓
- No unguarded public endpoints introduced ✓
- No `Number()` on financial fields (no money logic in this module) ✓
- No `deletedAt: null` missing (no DB queries) ✓
- No hardcoded secrets or API keys ✓
- No raw `$queryRaw` ✓

---

### ⚠️ Warning — 2 Found

**W-001 · Access tokens in outbound GET request URLs**
- **Files**: `facebook-app-review.service.ts` lines ~313, 351, 409, 424
- **Description**: Facebook Graph API calls for GET requests pass the page/user access token as a URL query parameter: `?access_token=${token}`. While this is Facebook's documented pattern and the application logger correctly redacts them (`access_token=***`), the raw token will still appear in any outbound HTTP proxy access logs or network appliance logs at the infrastructure level.
- **Recommendation**: Use the `Authorization: Bearer <token>` header for outbound Graph API calls instead. Facebook's API supports this for all endpoints. Example:
  ```ts
  headers: { Authorization: `Bearer ${token}` }
  ```
  Then remove `access_token=...` from GET URLs.

**W-002 · Broken "runbook" link in frontend component**
- **File**: `FacebookAppReviewPanel.tsx` line ~901
- **Description**: The external link `href="/docs/guides/FACEBOOK-APP-REVIEW.md"` points to a file path that Vite's dev server won't serve (it's outside `public/`). In production this would 404.
- **Recommendation**: Either host the runbook as a static asset under `apps/web/public/`, link to the GitHub URL, or remove the link if not needed for the App Review UI.

---

### ℹ️ Info — 2 Found

**I-001 · Large component file**
- **File**: `FacebookAppReviewPanel.tsx` — 390 lines
- **Description**: The component is self-contained and well-structured (types → constants → sub-component → export), so splitting is optional. No action required unless the panel grows further.

**I-002 · Service reads credentials from `ConfigService` (env vars only)**
- **Description**: This branch reads FB credentials only from environment variables. A follow-up branch (`feat/facebook-app-review-db-config`) migrates to DB-based credentials via `IntegrationConfigService`. These two branches should be merged together or in order — merging this branch alone means the owner cannot configure credentials from the Integration Hub UI.
- **Recommendation**: Merge `feat/facebook-app-review-db-config` as a direct follow-up, or merge them together. Do not leave this branch alone in production.

---

## Recommendation

**REVIEW — do not merge alone**

The code quality is good (guards present, validation correct, Sentry coverage, timeout handling). However:

1. **W-001** (token exposure in URLs) should be fixed before going to production.  
2. **I-002** — this branch is incomplete without `feat/facebook-app-review-db-config`; the two should ship together.

Fix W-001 and merge with the db-config branch, then the combined feature can be APPROVED.
