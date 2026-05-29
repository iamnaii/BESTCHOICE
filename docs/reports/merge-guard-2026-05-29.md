# Pre-Merge Guard Report — 2026-05-29

**Agent:** Pre-Merge Guard  
**Date:** 2026-05-29  
**Branches reviewed:** 3 (top 3 most-recently-pushed non-guard feature branches)

---

## Summary

| Branch | Author | Files | +/- | Recommendation |
|--------|--------|-------|-----|----------------|
| `fix/fb-webhook-integration-config` | Akenarin Kongdach | 3 | +96/−11 | ✅ APPROVE |
| `feat/canned-response-channel-tabs` | Akenarin Kongdach | 5 | +277/−20 | ✅ APPROVE |
| `feat/data-deletion-page` | Akenarin Kongdach | 2 | +125/0 | ✅ APPROVE |

No Critical issues found across all three branches.

---

## Branch 1 — `fix/fb-webhook-integration-config`

**Commit:** `fix(facebook-webhook): resolve verify token + app secret from IntegrationConfig`

### File changes
- `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` — moves `appSecret` + `verifyToken` resolution from `ConfigService` (env-only) to `IntegrationConfigService` (DB → env fallback)
- `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` — updates all 3 test suites to inject `IntegrationConfigService` mock; adds new `verifyWebhook` suite with 3 test cases
- `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` — imports `IntegrationsModule`

### Critical — None found

- **No missing `@UseGuards`:** Controller is intentionally public (Facebook webhook). Listed in `security.md` under "Intentionally Public Endpoints". ✅
- **No `Number()` on money:** No financial fields in scope. ✅
- **No missing `deletedAt: null`:** No new Prisma queries introduced. ✅
- **No hardcoded secrets:** `appSecret` / `verifyToken` now live in DB, sourced from `IntegrationConfigService`. ✅
- **Fail-closed on empty verify token:** `verifyWebhook` explicitly guards `verifyToken && token === verifyToken` — an empty/null DB value correctly returns 400. ✅
- **HMAC async migration safe:** `verifySignature` and `handleDataDeletion` both awaited correctly at all call sites. ✅

### Warning — None found

### Info
- `verifyWebhook` changed from `void` to `async Promise<void>`. NestJS handles async controller methods transparently — no issue.
- 3 new test cases cover: token match, token mismatch, empty-token fail-closed. Good coverage.

### Recommendation: **APPROVE**

---

## Branch 2 — `feat/canned-response-channel-tabs`

**Commits:**
1. `feat(canned-response): add per-channel tabs in template editor`
2. `fix(canned-response): Phase 2b — review issues C/W1/W2 channel tabs`

### File changes
- `apps/web/src/pages/canned-response-admin/BubbleList.tsx` — adds `channelFilter` + `onCountsChange` props; filters visible bubbles; scopes new bubbles to active channel tab; delegates reorder to extracted `reorderBubbles()`
- `apps/web/src/pages/canned-response-admin/ChannelTabs.tsx` *(new)* — tab bar with badge counts; uses `aria-pressed` on buttons
- `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` — wires `ChannelTabs` into editor, resets active channel on template switch
- `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts` *(new)* — pure reorder function; operates on full bubble array to preserve hidden-channel order
- `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts` *(new)* — 7 unit tests (Vitest)

### Critical — None found

- **No raw `fetch()`:** All API calls use `api.post()` / `api.get()` from `@/lib/api`. ✅
- **`invalidateQueries()` present:** `invalidate()` is called in all mutation `onSuccess` handlers. ✅
- **No hardcoded colors:** Uses `bg-primary`, `text-primary-foreground`, `bg-muted`, `text-muted-foreground`, `border-border` exclusively. ✅

### Warning — 1 found

**W1 — `useEffect` with potentially unstable `onCountsChange` dep**
- File: `BubbleList.tsx` (the counts-reporting `useEffect`)
- Current caller (`TemplateEditorPane.tsx`) passes `setBubbleCounts` — a stable React state setter — so no issue today.
- If a future caller passes an inline arrow function as `onCountsChange`, the effect would re-run every render. Consider wrapping with `useCallback` at the call site or adding an ESLint comment noting the stability assumption.
- Not a merge blocker.

### Info
- `leading-snug` applied consistently on all Thai text. ✅
- `aria-pressed` on channel tab buttons — good a11y. ✅
- 7 unit tests for `reorderBubbles` cover: basic reorder, cross-channel hidden preservation, identical-from-to no-op, missing id no-op, universal bubbles coexisting with channel-scoped. Solid coverage.
- Cap of 5 bubbles now correctly applies to total (all channels), not just visible. Comment explains this clearly.

### Recommendation: **APPROVE**

---

## Branch 3 — `feat/data-deletion-page`

**Commit:** `feat(privacy): add public /privacy/data-deletion instructions page`

### File changes
- `apps/web/src/App.tsx` — adds lazy-loaded route `/privacy/data-deletion`
- `apps/web/src/pages/DataDeletionPage.tsx` *(new)* — static PDPA/Meta compliance page (123 lines)

### Critical — None found

- **No auth guard on route** — correct. This is a public static page (Meta App Review requires a publicly accessible data deletion URL). ✅
- **Lazy-loaded:** `React.lazy(() => import('@/pages/DataDeletionPage'))` — follows pattern for all pages. ✅
- **No data fetching:** Purely static HTML-equivalent JSX. ✅
- **No hardcoded colors:** Uses `bg-background`, `bg-muted`, `text-foreground`, `text-muted-foreground`. ✅
- **No `text-gray-*` / `bg-white`:** ✅

### Warning — None found

### Info
- Route placed alongside `/privacy` (non-authenticated zone) — consistent with existing privacy policy route. ✅
- `leading-snug` on Thai text. ✅
- English summary section included — satisfies Meta's requirement for English-readable data deletion instructions.
- Contains contact email (`akenarin.ak@gmail.com`) and phone number — intentional for a PDPA compliance contact page. Not a security concern.
- Date "24 พฤษภาคม 2569" in the page header. Confirm this matches intended last-updated date before merge.

### Recommendation: **APPROVE**

---

## Checklist

| Check | Branch 1 | Branch 2 | Branch 3 |
|-------|----------|----------|----------|
| `@UseGuards` on new controllers | ✅ (exempt) | n/a | n/a |
| `@Roles()` on controller methods | ✅ (exempt) | n/a | n/a |
| No `Number()` on money fields | ✅ | ✅ | ✅ |
| `deletedAt: null` in queries | ✅ | ✅ | ✅ |
| No hardcoded secrets | ✅ | ✅ | ✅ |
| No raw `$queryRaw` unparameterized | ✅ | ✅ | ✅ |
| DTO validation decorators | ✅ | ✅ | ✅ |
| No raw `fetch()` in React | n/a | ✅ | ✅ |
| `invalidateQueries()` after mutations | n/a | ✅ | n/a |
| No hardcoded hex/gray colors | ✅ | ✅ | ✅ |
| `leading-snug` on Thai text | n/a | ✅ | ✅ |
| Lazy-loaded pages | n/a | n/a | ✅ |
