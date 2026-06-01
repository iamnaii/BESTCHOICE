# Pre-Merge Guard Report — 2026-06-01

**Reviewed by:** Pre-Merge Guard Agent  
**Date:** 2026-06-01  
**Branches reviewed:** 3 of 679 open (most recently updated feature/fix branches)

---

## Branch 1 — fix/fb-webhook-integration-config

**Commit:** `fix(facebook-webhook): resolve verify token + app secret from IntegrationConfig`  
**Author:** Akenarin Kongdach  
**Base:** main  
**Files changed:** 3 (+96 / -11 lines)

| File | Change |
|------|--------|
| `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` | +3 lines — adds `IntegrationsModule` import |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | +25 / -11 — migrates `FB_APP_SECRET` + `FB_VERIFY_TOKEN` from `ConfigService` env-only to `IntegrationConfigService` (DB → env fallback) |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` | +68 lines — new test suite for verify-token flow (3 cases: match / mismatch / empty = fail-closed) |

### Critical
_None._

### Warning
- **`FacebookWebhookController` not listed in security.md exception list** (`apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts`).  
  The controller is correctly marked "intentionally public (no JwtAuthGuard)" in its own JSDoc and uses HMAC-SHA256 to authenticate payloads — this is architecturally sound. However `.claude/rules/security.md` lists only five public controllers (`chatbot-finance-liff`, `sms-webhook`, `paysolutions`, `address`, `shop/public-config`). `webhooks/facebook` is missing from that list.  
  **Action:** Add a line for `facebook-webhook` (webhooks/facebook) to the intentionally-public section of `security.md` before merging, so future guard audits don't flag it as an unknown exception.

### Info
- `verifySignature` was synchronous; it is now `async` to await `getAppSecret()`. The call site (`handleWebhook`) already had `await this.verifySignature(...)` added — no silent breakage.
- The fail-closed behaviour when `verifyToken` is empty or unset is correct and tested (`rejects with 400 when no verify token is configured`).
- New tests mock `IntegrationConfigService` correctly and are added to all three existing `describe` blocks — good coverage hygiene.

### Recommendation: **REVIEW** 🔶

One doc update needed (`security.md`) before merge — no code changes required.

---

## Branch 2 — fix/letters-e2e-sales-assertion

**Commit:** `fix(letters): E2E SALES assertion was matching CANCELLED tab button`  
**Author:** Akenarin Kongdach  
**Base:** main  
**Files changed:** 1 (+8 / -4 lines)

| File | Change |
|------|--------|
| `apps/web/e2e/letters-page.spec.ts` | Rewrites the SALES-role test from "no ยกเลิก button" (brittle — tab label collision) to "heading visible + URL contains /letters" |

### Critical
_None._

### Warning
_None._

### Info
- The explanation in the PR comment is accurate: the `CANCELLED` status tab also carries text "ยกเลิก", so `getByRole('button', { name: 'ยกเลิก' })` matched the tab button and produced a false negative. The replacement assertion (heading visible + URL stays on `/letters`) is the correct fix.
- Role-level cancel button enforcement is properly covered at the API level (controller `@Roles`) + unit level (LetterTable component logic), as stated in the updated test comment.

### Recommendation: **APPROVE** ✅

---

## Branch 3 — feat/canned-response-channel-tabs

**Commits:**
- `feat(canned-response): add per-channel tabs in template editor`
- `fix(canned-response): Phase 2b — review issues C/W1/W2 channel tabs`

**Author:** Akenarin Kongdach  
**Base:** main  
**Files changed:** 5 (+277 / -20 lines)

| File | Change |
|------|--------|
| `apps/web/src/pages/canned-response-admin/ChannelTabs.tsx` | New — 63 lines, tab bar with badge counts per channel |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts` | New — 31 lines, pure reorder helper extracted from `BubbleList` |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts` | New — 100 lines, 7 test cases covering filtered/unfiltered/universal-bubble scenarios |
| `apps/web/src/pages/canned-response-admin/BubbleList.tsx` | +34 / -17 — consumes `channelFilter` + `onCountsChange` props; moves reorder into extracted helper |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | +17 / -3 — wires `ChannelTabs` above `BubbleList`, resets active tab on template switch |

### Critical
_None._

### Warning
_None._

### Info
- **Design tokens**: all colours use semantic tokens (`bg-primary`, `text-primary-foreground`, `bg-muted`, `text-muted-foreground`, `bg-background`, etc.) — no hardcoded hex. ✓
- **Thai text**: all new Thai strings use `leading-snug`. ✓
- **API calls**: `api.get()` / `api.post()` from `@/lib/api` throughout. No raw `fetch()`. ✓
- **Cache invalidation**: `qc.invalidateQueries()` called in `invalidate()` on every mutation `onSuccess`. ✓
- **`onCountsChange` in `useEffect` deps** (`BubbleList.tsx`): the dep array `[allBubbles, onCountsChange]` is safe here because the only current caller passes `setBubbleCounts` (a stable React state setter). If this component is ever reused with an inline callback it will loop. Low risk but worth a `useCallback` in the parent or a comment noting the stability expectation.
- **`(r: any)` / `(e: any)`** in `queryFn` and `onError` — consistent with the existing codebase pattern for React Query responses; no action needed.
- `reorderBubbles` is a well-tested pure function (7 test cases, including cross-channel drag preservation and universal-bubble edge cases).

### Recommendation: **APPROVE** ✅

---

## Summary

| Branch | Verdict | Blocker |
|--------|---------|---------|
| `fix/fb-webhook-integration-config` | 🔶 REVIEW | Add `facebook-webhook` to `security.md` public-endpoint exception list |
| `fix/letters-e2e-sales-assertion` | ✅ APPROVE | — |
| `feat/canned-response-channel-tabs` | ✅ APPROVE | — |
