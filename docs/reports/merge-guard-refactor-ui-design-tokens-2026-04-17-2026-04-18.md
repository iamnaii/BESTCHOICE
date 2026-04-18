# Merge Guard Report — refactor/ui-design-tokens-2026-04-17

**Date**: 2026-04-18
**Branch**: `refactor/ui-design-tokens-2026-04-17`
**Author**: Akenarin Kongdach (last commit 2026-04-17 16:21)
**Base**: `origin/main`

## File Changes Summary

159 files changed, 1952 insertions(+), 1292 deletions(−)

Primary changes:
- `refactor(web): Phase 7/8` — tokenize 77 frontend files, eliminate color-scale violations
- `fix(chat): register adapters via OnModuleInit + surface send failures to UI`
- `fix(api): add missing canned_responses.response_type + media_url migration`
- `test(e2e): share login tokens across workers to beat throttle`
- New API files: `chat-adapters/line-finance.adapter.ts`, `chat-engine/services/message-router.service.ts`, `facebook-domain/facebook-domain.module.ts`, `staff-chat/staff-chat.gateway.ts`

---

## Issues by Severity

### Critical — 0 issues

No critical issues found:
- No new controllers introduced (only services, gateways, adapters — no `@Controller` added) ✅
- No `Number()` on Prisma money/Decimal fields ✅
- No missing `deletedAt: null` in new queries ✅
- No hardcoded secrets or API keys ✅
- No unparameterized `$queryRaw` ✅

### Warning — 1 issue

**W-001**: New `saveCreditCheckMutation` in `CreditChecksPage` uses raw `api.post` inside `mutationFn` — but this follows the correct pattern and has `queryClient.invalidateQueries({ queryKey: ['credit-checks'] })` in `onSuccess` ✅. The refactor migrates away from an ad-hoc `.catch()` chain to a proper `useMutation`, which is an improvement. **No action needed.**

### Info — 3 items

**I-001**: New migration `20260430000000_add_canned_response_type_media/migration.sql` uses `ADD COLUMN IF NOT EXISTS` with `DEFAULT 'text'` — safe for production apply. Fixes a schema-drift bug where CI failed with `P2022 column response_type does not exist`. Correct approach.

**I-002**: New `LineFinanceAdapter` and `MessageRouterService` are `@Injectable()` services registered via module providers, not HTTP endpoints — no `@UseGuards` required. The `OnModuleInit` adapter-registration pattern in `FacebookDomainModule` and `LineDomainModule` is clean and avoids circular dependencies.

**I-003**: `text-success` token used in LIFF pages (`LiffPayment.tsx`, `LiffRegister.tsx`). Verify `text-success` is defined in `index.css` CSS variables (not an implicit Tailwind color). If it resolves to an emerald/green semantic token, this is fine. If it is undefined, it will silently produce no color.

---

## Recommendation

**APPROVE**

The branch achieves its stated goal: eliminate hardcoded color classes and migrate to CSS design tokens across 77+ files. No security, money-precision, or data-integrity issues found. The chat engine improvements (send-failure surface, adapter registration via `OnModuleInit`) are correctness improvements. Migration is additive and safe.

**Action before merge**: Confirm `text-success` token is defined in `index.css` (I-003).
