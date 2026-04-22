# Merge Guard Report — feat/facebook-app-review-db-config

**Date**: 2026-04-22  
**Branch**: `feat/facebook-app-review-db-config`  
**Author**: Akenarin Kongdach  
**Base**: `origin/main`  
**Commits**: 1 (on top of `feature/facebook-app-review`)

## File Changes Summary

| File | Lines +/- | Type |
|------|-----------|------|
| `apps/api/src/modules/facebook-app-review/facebook-app-review.module.ts` | +2 | Adds IntegrationsModule import |
| `apps/api/src/modules/facebook-app-review/facebook-app-review.service.ts` | +96 / -59 | Migrates ConfigService → IntegrationConfigService |
| `apps/api/src/modules/integrations/integration-registry.ts` | +21 | Adds 3 new FB fields to registry |
| `docs/guides/FACEBOOK-APP-REVIEW.md` | minor updates | Runbook |

**Total**: 4 files, ~96 insertions, ~59 deletions

---

## Context

This branch depends on `feature/facebook-app-review`. It replaces `ConfigService` (env vars) with `IntegrationConfigService` (DB-backed, with env var fallback) for all Facebook credentials, allowing the owner to manage tokens from the Integration Hub UI without redeploying.

The `getValue()` chain is: **DB → env var → default** — backward-compatible with existing `.env` configuration.

---

## Issues by Severity

### ✅ Critical — None Found

- No new controllers introduced (inherits guards from parent branch) ✓
- `IntegrationsModule` correctly exports `IntegrationConfigService` ✓
- `getConfig('facebook')` uses `deletedAt: null` in inner DB queries (via existing `getValue`) ✓
- No `Number()` on financial fields ✓
- No hardcoded secrets ✓

---

### ⚠️ Warning — 1 Found

**W-001 · `getCreds()` uncaught `NotFoundException` from `getConfig()`**
- **File**: `facebook-app-review.service.ts`, `getCreds()` method
- **Description**: `IntegrationConfigService.getConfig()` throws `NotFoundException` if the integration key is not found in the registry. While `'facebook'` is currently registered, an admin could theoretically rename or remove it. The exception would surface as a 404 from the NestJS exception filter rather than the expected 400 with a Thai error message.
- **Recommendation**: Wrap in try-catch or document that 'facebook' key is stable:
  ```ts
  private async getCreds() {
    try {
      const cfg = await this.integrationConfig.getConfig('facebook');
      return { ... };
    } catch {
      throw new BadRequestException('ยังไม่ได้ตั้งค่า Facebook integration');
    }
  }
  ```

---

### ℹ️ Info — 1 Found

**I-001 · `adAccountId` marked `sensitive: false` in integration-registry.ts**
- **File**: `integration-registry.ts` line ~213
- **Description**: Ad Account IDs identify the advertiser and could reveal business identity. Other token fields in the same block are `sensitive: true`. Not a security vulnerability but marking it `sensitive: true` would mask it in the UI like other credentials.
- **Recommendation**: Change `sensitive: false` to `sensitive: true` for `adAccountId`.

---

## Prerequisite

This branch **requires `feature/facebook-app-review` to be merged first** (or merged together). It modifies the service introduced in that branch.

---

## Recommendation

**REVIEW — fix W-001 and merge after parent branch**

The migration from env vars to DB-backed credentials is clean and correct. The `getConfig()` fallback chain preserves backward compatibility. Fix W-001 (exception wrapper) and address I-001 (`adAccountId` sensitivity), then this branch is **APPROVE** once its parent is merged.
