# Merge Guard Report — `feature/facebook-app-review`

**Date**: 2026-04-23  
**Branch**: `feature/facebook-app-review`  
**Author**: Akenarin Kongdach  
**Last commit**: 2026-04-22  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

| File | +/- |
|------|-----|
| `apps/api/src/app.module.ts` | +3 |
| `apps/api/src/modules/facebook-app-review/dto/facebook-app-review.dto.ts` | +82 (new) |
| `apps/api/src/modules/facebook-app-review/facebook-app-review.controller.ts` | +92 (new) |
| `apps/api/src/modules/facebook-app-review/facebook-app-review.module.ts` | +17 (new) |
| `apps/api/src/modules/facebook-app-review/facebook-app-review.service.ts` | +279 (new) |
| `apps/web/src/components/FacebookAppReviewPanel.tsx` | +390 (new) |
| `apps/web/src/pages/IntegrationHubPage.tsx` | +4 |
| `docs/guides/FACEBOOK-APP-REVIEW.md` | +160 (new) |

**Total**: 8 files, 1 027 insertions

---

## Issues

### 🔴 Critical — None

### 🟡 Warning (2)

**W-1 · Multi-line docstring blocks in service file**  
`facebook-app-review.service.ts` — The service contains extensive multi-line JSDoc/comment blocks (e.g., the permission→endpoint map at the top, and per-method `/** */` blocks). CLAUDE.md coding standard: "Don't write multi-line comment blocks — one short line max." The intent is valuable, but the format violates the project rule. Consider condensing to one-liners or moving to the runbook.

**W-2 · `FacebookAppReviewPanel.tsx` is 390 lines**  
The panel is a single file approaching the 500-line guideline. No immediate action required, but if more permission tests are added this file will need splitting into smaller `TestGroup` subcomponents.

### 🔵 Info (1)

**I-1 · Access tokens in URL query parameters (server-side)**  
`facebook-app-review.service.ts` embeds `access_token=` in GET request URLs (standard Facebook Graph API pattern). The service correctly redacts tokens before logging (`url.replace(/access_token=[^&]+/g, 'access_token=***')`). This is Facebook's documented approach and is acceptable. No action needed.

---

## Security Checklist

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on controller class | ✅ Present |
| `@Roles(...)` on every method | ✅ `'OWNER'` on all 9 endpoints |
| No `Number()` on money fields | ✅ No financial fields (`dailyBudget` is ad budget sent to Facebook, not stored in DB) |
| No raw SQL / `$queryRaw` | ✅ No DB queries |
| No `deletedAt` query gap | ✅ No DB queries |
| No hardcoded secrets | ✅ All tokens via `ConfigService` |
| Frontend uses `api.get()`/`api.post()` | ✅ All API calls use `@/lib/api` |
| No raw `fetch()` in frontend | ✅ Clean |
| DTO validation decorators | ✅ Full class-validator coverage with Thai messages |

---

## Recommendation: ✅ APPROVE

The module is a clean, well-scoped addition — new endpoints are OWNER-only, no DB writes, no financial arithmetic, and frontend follows all required patterns. Fix W-1 (comment style) in a follow-up; it does not block merge.
