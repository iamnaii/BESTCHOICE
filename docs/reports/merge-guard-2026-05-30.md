# Merge Guard Report — 2026-05-30

**Date**: 2026-05-30  
**Branches reviewed**: 2 (of 665 unmerged; top 3 by recency selected; 1 already merged)  
**Reviewer**: Pre-Merge Guard (automated)

---

## Branches Reviewed

| Branch | Author | Last Commit | Ahead | Behind |
|--------|--------|-------------|-------|--------|
| `fix/fb-webhook-integration-config` | Akenarin Kongdach | 2026-05-28 | 1 | 6 |
| `fix/letters-e2e-sales-assertion` | Akenarin Kongdach | 2026-05-26 | 1 | 17 |

**Not reviewed** — `fix/integrations-accountant-read` (0 commits ahead of main; already merged via PR #1114).

---

## Branch 1: `fix/fb-webhook-integration-config`

### File Changes Summary

3 files changed, 96 insertions(+), 11 deletions(-)

| File | Change |
|------|--------|
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | Read verify token + app secret from `IntegrationConfigService` (DB) instead of raw env vars; `verifySignature` made async |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` | 3 new describe blocks covering token-match, token-mismatch, and empty-token (fail-closed) paths |
| `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` | Added `IntegrationsModule` import to provide `IntegrationConfigService` |

### What the fix does

`FacebookWebhookController` previously read `FB_VERIFY_TOKEN` and `FB_APP_SECRET` directly from NestJS `ConfigService` (env vars). Changing them required a redeployment. This fix routes both values through `IntegrationConfigService.getConfig('facebook')`, which reads from DB (with a TTL cache) and falls back to env. The admin can now update tokens via Settings → Integrations without redeploying.

### Issues by Severity

#### Critical — None

- Controller remains intentionally public (no `JwtAuthGuard`) — this is correct and documented in `.claude/rules/security.md` as an allowed exception for `paysolutions` and webhook endpoints.
- No new money arithmetic. No `Number()` calls on financial fields.
- No hardcoded secrets; the fix moves secrets *away* from env-only and into the DB-backed config store.
- No unparameterized `$queryRaw`.
- `IntegrationsModule` does not import `ChatAdaptersModule` back — no circular dependency risk confirmed.

#### Warning — None

- `verifySignature` changed from sync to async; all three call sites (`handleWebhook`, `handleDataDeletion`, `handleDeactivation`) were correctly updated with `await`. No missed async boundary.
- `IntegrationConfigService` has a TTL-based in-memory cache (`CACHE_TTL_MS`). The `getAppSecret()` helper is called up to 3 times per POST request, but all hits after the first go to cache — no N+1 DB issue.

#### Info — 1

**I1 — TypeScript type precision: `Record<string, string>` allows silent `undefined` access**

`IntegrationConfig = Record<string, string>` means TypeScript sees `cfg.appSecret` as `string` rather than `string | undefined`. At runtime, if the key is absent, the value is `undefined`. The code correctly guards against this (`cfg.verifyToken || undefined` + `&& verifyToken` conditional), so it is **safe** — but TypeScript will not catch future callers that forget to guard. Low risk given the existing defensive pattern; noted for awareness.

### Recommendation: ✅ APPROVE

Clean implementation. The fail-closed guard (`verifyToken && token === verifyToken`) correctly rejects webhooks when the DB config has no token set (empty string becomes `undefined`). New tests cover all three token-check paths. No production-safety issues.

---

## Branch 2: `fix/letters-e2e-sales-assertion`

### File Changes Summary

1 file changed, 8 insertions(+), 4 deletions(-)

| File | Change |
|------|--------|
| `apps/web/e2e/letters-page.spec.ts` | Rename test + replace brittle button-count assertion with page-heading + URL check |

### What the fix does

The old test (`SALES role: no row Cancel button (X icon)`) asserted:
```ts
await expect(page.getByRole('button', { name: 'ยกเลิก', exact: true })).toHaveCount(0);
```
The "CANCELLED" status filter tab also carries the text `ยกเลิก`, so the selector returned the wrong element and the assertion was unreliable. The fix narrows the test to what it actually validates (SALES can access `/letters` without being redirected) and defers the role-based cancel-button logic to backend unit tests (`POST /overdue/letters/:id/cancel → 403 for SALES`) and component tests.

### Issues by Severity

#### Critical — None
#### Warning — None
#### Info — None

Pure E2E test fix; no production code changed.

### Recommendation: ✅ APPROVE

The new assertion is correct, stable, and accurately reflects the test intent. The comment explaining what is _not_ tested here and where it is tested elsewhere is good documentation.

---

## Overall Summary

| Branch | Critical | Warning | Info | Verdict |
|--------|----------|---------|------|---------|
| `fix/fb-webhook-integration-config` | 0 | 0 | 1 | ✅ APPROVE |
| `fix/letters-e2e-sales-assertion` | 0 | 0 | 0 | ✅ APPROVE |

Both branches are merge-ready. The one info-level note on `fix/fb-webhook-integration-config` (TypeScript type precision) is a future code-quality observation and does not block merging.
