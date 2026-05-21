# Pre-Merge Guard Report — AI Feature Branches
**Date**: 2026-05-21  
**Reviewer**: Pre-Merge Guard (automated)  
**Branches reviewed**: 3 most recently updated (of 557 unmerged)

---

## Summary

| Branch | Author | Files | +Lines | Recommendation |
|--------|--------|-------|--------|----------------|
| `feat/ai-settings-llm-provider-toggle` | Akenarin Kongdach | 7 | +187 | ⚠️ REVIEW |
| `feat/shop-ai-gemini-dual-mode` | Akenarin Kongdach | 2 | +372 | ⚠️ REVIEW |
| `feat/ai-menu-separate` | Akenarin Kongdach | 2 | +17 | ✅ APPROVE |

---

## Branch 1: `feat/ai-settings-llm-provider-toggle`

**Author**: Akenarin Kongdach  
**Commit**: `7d28a89a`  
**Description**: Adds a runtime-switchable LLM provider toggle (Claude ↔ Gemini) to the AI settings UI. Owner can flip the provider from the SHOP Bot Setup form; the change takes effect immediately (registry cache is invalidated on save, no 60s TTL wait, no redeploy required).

### Files Changed
```
apps/api/src/modules/sales-bot/providers/llm-provider.registry.spec.ts  (+16)
apps/api/src/modules/sales-bot/providers/llm-provider.registry.ts       (+11)
apps/api/src/modules/staff-chat/dto/ai-settings.dto.ts                  (+10)
apps/api/src/modules/staff-chat/services/__tests__/shop-ai-flow.unit.spec.ts (+2)
apps/api/src/modules/staff-chat/services/ai-auto-reply.service.spec.ts  (+85)
apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts       (+34)
apps/web/src/pages/AiSettingsPage.tsx                                    (+31)
```

### Issues

#### Critical
_None found._

#### Warning

**W1 — Possible missing `queryClient.invalidateQueries` in `ShopBotSetupForm`**  
File: `apps/web/src/pages/AiSettingsPage.tsx`

The diff shows `saveMutation.onSuccess` contains `toast.success(...)` but no `queryClient.invalidateQueries(['shopBotConfig'])` call is visible in the surrounding diff context. Per frontend rules, every mutation must call `invalidateQueries` after success. If omitted, the `['shopBotConfig']` query cache won't reflect the newly saved `llmProvider` value for any other component consuming that cache key.

Functional impact is low (the `ShopBotSetupForm` updates its own local state), but the rule exists precisely to prevent stale-cache bugs when multiple pages share the same query key.

**Action**: Verify `queryClient.invalidateQueries` is present in `onSuccess`. If missing, add:
```tsx
onSuccess: () => {
  toast.success('บันทึก SHOP Bot Setup เรียบร้อย');
  queryClient.invalidateQueries({ queryKey: ['shopBotConfig'] });
},
```

**W2 — No `*.module.ts` changes for new `LlmProviderRegistry` injection**  
File: `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts`

`AiAutoReplyService` now injects `LlmProviderRegistry` (from `sales-bot/providers/`) as a constructor dependency. The diff contains no changes to `StaffChatModule` or `SalesBotModule`. If `LlmProviderRegistry` is not exported from `SalesBotModule` and that module is not imported in `StaffChatModule`, NestJS DI will throw `Nest can't resolve dependencies of AiAutoReplyService` at runtime. Unit tests mock it explicitly so this would not be caught by the test suite.

**Action**: Confirm `SalesBotModule` exports `LlmProviderRegistry` and is imported by `StaffChatModule` (or that `LlmProviderRegistry` is directly provided there). If `SalesBotService` injection was already working, this likely means `SalesBotModule` is already imported — just confirm `LlmProviderRegistry` is in the `exports` array.

#### Info

- **I1**: DTO validation is correct — `@IsIn(LLM_PROVIDERS, { message: 'llmProvider ต้องเป็น "claude" หรือ "gemini" เท่านั้น' })` with Thai message. ✅
- **I2**: Excellent test coverage: 2 new spec tests for `invalidateCache()` in registry, 6 new tests for `getSettings`/`updateSettings` with case-insensitive parsing and fallback behavior. ✅
- **I3**: Cache invalidation logic is clean and idempotent — safe to call even when value didn't change. ✅

### Recommendation: ⚠️ REVIEW
Fix W1 (verify `invalidateQueries`) and W2 (confirm module wiring) before merge. Neither is likely a blocker in practice but both violate project rules and W2 could cause a runtime failure.

---

## Branch 2: `feat/shop-ai-gemini-dual-mode`

**Author**: Akenarin Kongdach  
**Commit**: `bb39d5a6`  
**Description**: Expands `GeminiProvider` to support two transport modes: AI Studio (via `GEMINI_API_KEY`) and Vertex AI (via `GOOGLE_CLOUD_PROJECT`). Adds `thinkingBudget: 0` for Gemini 2.5+ models to suppress hidden reasoning tokens.

### Files Changed
```
apps/api/src/modules/sales-bot/providers/gemini.provider.spec.ts  (+302, -220)
apps/api/src/modules/sales-bot/providers/gemini.provider.ts        (+164, -56)
```

### Issues

#### Critical
_None found._

#### Warning

**W1 — Breaking env var rename: `VERTEX_GEMINI_MODEL` → `GEMINI_MODEL`**  
File: `apps/api/src/modules/sales-bot/providers/gemini.provider.ts`, line ~64

The constructor previously read `VERTEX_GEMINI_MODEL`; the new code reads `GEMINI_MODEL`. Any production/staging Cloud Run environment that has `VERTEX_GEMINI_MODEL=gemini-2.0-flash-001` set will silently **stop honouring that value** after this deploy. The provider will fall back to the `DEFAULT_MODEL = 'gemini-2.5-flash'` constant, which is a different model with different cost/quality characteristics.

This is a silent regression: no error, no log warning, wrong model used. Cost impact: Gemini 2.5-flash is substantially different from 2.0-flash-001 in pricing.

**Action**: Either:
- (a) Read both keys with fallback: `this.config.get('GEMINI_MODEL') ?? this.config.get('VERTEX_GEMINI_MODEL') ?? DEFAULT_MODEL` to maintain backward compat during transition; or
- (b) Add an explicit migration note in `DEPLOY.md` and ensure Cloud Run env var is updated atomically with the deploy.

**W2 — Default model changed from `gemini-2.0-flash-001` to `gemini-2.5-flash`**  
This is intentional and well-documented (thinkingBudget=0 rationale is in a comment), but the cost change (~8x difference mentioned in comment) should be sign-off'd before production deploy. Flag for owner awareness.

#### Info

- **I1**: `GEMINI_API_KEY` appears as a URL query parameter (`?key=${this.apiKey}`). This is Google's documented auth pattern for `generativelanguage.googleapis.com`. Since the call is made server-side from NestJS (not from the browser), the key won't appear in browser history. Key may appear in Cloud Run request logs if outbound HTTP is logged. Low risk — acceptable per Google API design. ✅
- **I2**: Error messages changed from Thai to English. These are `ServiceUnavailableException` messages that surface in API error responses. Consider whether a caller (e.g., admin UI) displays these raw. Minor convention deviation.
- **I3**: Test coverage significantly improved — 12 tests covering both modes, mode detection, thinkingConfig, error handling. Well structured with `buildProvider` / `fakeFetchResponse` factory helpers. ✅
- **I4**: `isReady()` now correctly returns `false` when neither env is set, allowing registry to fall back to Claude. Defensive design. ✅

### Recommendation: ⚠️ REVIEW
Address W1 (breaking env var rename) before merge. W2 requires owner sign-off on model upgrade. No security blockers.

---

## Branch 3: `feat/ai-menu-separate`

**Author**: Akenarin Kongdach  
**Commit**: `9100b931`  
**Description**: Moves AI sub-menu items out of the "ตั้งค่า" section and into a dedicated top-level "AI" section in the settings zone of the owner sidebar.

### Files Changed
```
apps/web/package.json        (+1, -1)
apps/web/src/config/menu.ts  (+17, -13)
```

### Issues

#### Critical
_None found._

#### Warning
_None found._

#### Info

- **I1**: `package.json` version bump is the only other change — routine. ✅
- **I2**: Comment in `menu.ts` explains the design rationale for the separation (settings group was crowded). Borderline by coding-standards (comments should explain WHY that's non-obvious), but a menu restructuring decision qualifies as non-obvious. Acceptable. ✅
- **I3**: All 5 AI routes (`/settings/ai-admin`, `/settings/ai-persona`, `/settings/ai-chat`, `/settings/ai-training`, `/settings/ai-performance`) are preserved — no routes added or removed, just reorganised. ✅

### Recommendation: ✅ APPROVE
Clean UI restructuring. No functional changes, no security concerns.

---

## Security Checklist (all branches)

| Check | Branch 1 | Branch 2 | Branch 3 |
|-------|----------|----------|----------|
| New controllers have `@UseGuards(JwtAuthGuard)` | N/A (no new controllers) | N/A | N/A |
| `@Roles()` on all controller methods | N/A | N/A | N/A |
| Money fields use `Prisma.Decimal` not `Number()` | ✅ no money fields | ✅ no money fields | ✅ |
| All queries include `deletedAt: null` | ✅ SystemConfig.findMany (no soft-delete model) | ✅ | ✅ |
| No hardcoded secrets | ✅ | ✅ (key from ConfigService) | ✅ |
| No SQL injection (`$queryRaw`) | ✅ | ✅ | ✅ |
| Frontend uses `api.get/post`, not raw `fetch` | ✅ | N/A | N/A |
| DTO validators present + Thai messages | ✅ | N/A (no new DTOs) | N/A |

---

## Action Items Before Merge

| Priority | Branch | Item |
|----------|--------|------|
| ⚠️ High | `ai-settings-llm-provider-toggle` | Verify `queryClient.invalidateQueries` in `ShopBotSetupForm.onSuccess` |
| ⚠️ High | `ai-settings-llm-provider-toggle` | Confirm `LlmProviderRegistry` is in `SalesBotModule` exports & imported in `StaffChatModule` |
| ⚠️ High | `shop-ai-gemini-dual-mode` | Handle `VERTEX_GEMINI_MODEL` → `GEMINI_MODEL` env rename — backward compat or deploy note |
| ℹ️ Low | `shop-ai-gemini-dual-mode` | Owner sign-off on `gemini-2.5-flash` default model + cost implications |
| ✅ None | `ai-menu-separate` | Ready to merge |
