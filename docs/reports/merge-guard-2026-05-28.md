# Pre-Merge Guard Report — 2026-05-28

**Generated**: 2026-05-28  
**Reviewer**: Pre-Merge Guard agent  
**Scope**: 3 most recently updated unmerged feature/fix branches (of 650 total — guard/watchdog branches excluded)

---

## Branch 1: `fix/fb-webhook-integration-config`

**Author**: Akenarin Kongdach  
**Latest commit**: 2026-05-28  
**Changes**: 3 files changed, +96 / −11 lines

### File changes

| File | +/− |
|------|-----|
| `apps/api/src/modules/chat-adapters/chat-adapters.module.ts` | +3 |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts` | +68 |
| `apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts` | +25 / −11 |

### Summary

Migrates Facebook webhook verify token and app secret from hardcoded env-var lookups (`FB_VERIFY_TOKEN`, `FB_APP_SECRET`) to `IntegrationConfigService` with DB-backed storage and env fallback. Makes `verifyWebhook` and `verifySignature` async. Adds 57 lines of new tests covering the DB-config path and three fail-closed edge cases (wrong token, empty token, no config).

### Issues Found

**Critical**: None

**Warning**: None

**Info**:
- `facebook-webhook` controller is intentionally public (no `JwtAuthGuard`) but is missing from the "Intentionally Public Endpoints" allowlist in `.claude/rules/security.md`. Pre-existing omission — this controller predates this PR. Adding it to the list is a docs-only change and does not block merge.

### Recommendation: ✅ APPROVE

The change is a net security improvement — credentials move from env-only to DB-backed config with proper fail-closed behavior. The `verifyToken &&` guard in the verification path prevents matching on an empty/unconfigured token. Tests explicitly cover the fail-closed case.

---

## Branch 2: `feat/canned-response-channel-tabs`

**Author**: Akenarin Kongdach  
**Latest commit**: 2026-05-25  
**Changes**: 5 files changed, +277 / −20 lines

### File changes

| File | +/− |
|------|-----|
| `apps/web/src/pages/canned-response-admin/BubbleList.tsx` | +86 / −20 |
| `apps/web/src/pages/canned-response-admin/ChannelTabs.tsx` | +63 (new) |
| `apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx` | +17 |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts` | +100 (new) |
| `apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts` | +31 (new) |

### Summary

Adds per-channel tab filtering (ALL / LINE / Facebook / etc.) to the canned-response template editor's bubble list. Extracts drag-reorder logic into a pure function (`reorderBubbles`) that operates on the full `allBubbles` array — hidden bubbles keep their relative positions when reordering a filtered view. Ships 100 lines of unit tests covering cross-channel ordering scenarios including interleaved universal and channel-scoped bubbles.

### Issues Found

**Critical**: None

**Warning**: None

**Info**:
- `api.get(...).then((r: any) => r.data)` in `BubbleList.tsx` uses `any` — pre-existing pattern in this file, not introduced by this PR.
- `useEffect` in `BubbleList` depends on `[allBubbles, onCountsChange]`. In the current callsite, `onCountsChange` is always `setBubbleCounts` (stable React `useState` dispatch), so no infinite-render risk. If the prop were ever passed as an inline function from a future caller, the effect would re-run unnecessarily. Acceptable risk given current usage.

### Recommendation: ✅ APPROVE

Correct patterns throughout: `useQuery`/`useMutation`, `queryClient.invalidateQueries()`, `api.post()` from `@/lib/api`, design tokens only (no hardcoded hex), `leading-snug` on all Thai text. The pure reorder-logic extraction with well-scoped unit tests is a quality improvement over the previous inline logic.

---

## Branch 3: `feat/data-deletion-page`

**Author**: Akenarin Kongdach  
**Latest commit**: 2026-05-24  
**Changes**: 2 files changed, +125 lines

### File changes

| File | +/− |
|------|-----|
| `apps/web/src/App.tsx` | +2 |
| `apps/web/src/pages/DataDeletionPage.tsx` | +123 (new) |

### Summary

Adds a public static page at `/privacy/data-deletion` containing PDPA data deletion instructions. Required by Facebook/Meta as the "Data Deletion Instructions URL" in the Facebook App settings (Settings → Basic). No API calls — purely static content with contact details and a bilingual summary.

### Issues Found

**Critical**: None

**Warning**: None

**Info**:
- Contact email and phone number are hardcoded in JSX. Intentional for a legal/PDPA page, but changes to contact details require a code deployment rather than a config update.
- "ปรับปรุงล่าสุด: 24 พฤษภาคม 2569" hardcoded — acceptable for a "last updated" field on a legal static page.

### Recommendation: ✅ APPROVE

Public route with no `ProtectedRoute` wrapper (correct for a PDPA legal page), lazy-loaded via `React.lazy()`, uses design tokens exclusively, Thai text consistently uses `leading-snug`. No security surface — no API calls, no auth, no user input.

---

## Summary

| Branch | Files changed | Highest severity | Recommendation |
|--------|:---:|----------|:--------------:|
| `fix/fb-webhook-integration-config` | 3 | Info | ✅ APPROVE |
| `feat/canned-response-channel-tabs` | 5 | Info | ✅ APPROVE |
| `feat/data-deletion-page` | 2 | Info | ✅ APPROVE |

All 3 branches are merge-ready. No Critical or Warning issues found.

### Follow-up (non-blocking)

- Add `facebook-webhook` to the intentionally-public endpoints list in `.claude/rules/security.md` — documentation only, no code change needed.
