# Pre-Merge Guard Report

**Branch**: `feat/canned-response-admin-redesign`  
**Author**: Akenarin Kongdach (akenarin.ak@gmail.com)  
**Date**: 2026-05-30  
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

59 files changed, 8203 insertions(+), 661 deletions(-)

### Backend (apps/api)
- 3 new Prisma migrations (CannedResponseBubble, CannedResponseQuickReply, per-channel flags)
- Schema additions: `CannedResponseBubble`, `CannedResponseQuickReply` models
- New services: `CannedResponseBubbleService`, `CannedResponseQuickReplyService`, `CannedResponseSenderService`, `BubbleTranslatorService`
- Extended: `StaffChatController` (new bubble/quick-reply CRUD endpoints), `CannedResponseVariableService`, `MessageRouterService`
- New DTOs: `CreateBubbleDto`, `UpdateBubbleDto`, `CreateQuickReplyDto`, `UpdateQuickReplyDto`, `UpdateCannedResponseDto`
- New backfill CLI: `migrate-canned-response-content-to-bubbles.cli.ts`
- New test specs: bubble service, quickreply service, sender service, staff-chat controller

### Frontend (apps/web)
- `CannedResponseAdminPage.tsx` — full redesign with master-detail + DnD
- New component tree: `CategoryTreePane`, `TemplateEditorPane`, `BubbleList`, `ChannelTabs`, `QuickReplyEditor`, `MessageTemplatePicker`, `TemplateItem`, `CategoryHeader`, 7 bubble-editor subcomponents
- `ChatPanel.tsx` — removes `CommandPalette`, wires `MessageTemplatePicker`
- New test: `CannedResponseAdminPage.test.tsx`, `MessageTemplatePicker.test.tsx`, `bubble-reorder-logic.test.ts`

---

## Issues by Severity

### Critical
None.

Security checklist:
- **Guards**: `StaffChatController` retains class-level `@UseGuards(JwtAuthGuard, RolesGuard)`. All 13 new endpoints have explicit `@Roles()` decorators (read endpoints: all 4 roles; mutating endpoints: OWNER/BRANCH_MANAGER only). ✅
- **Money fields**: The one pre-existing `Number(payment.amountDue)` call in `CannedResponseVariableService` is being **removed** in this diff and replaced with `formatDecimalThai()` — a display-only string formatter that works from `String(Prisma.Decimal)`. This is a net improvement. ✅
- **Soft delete**: All new `findMany`/`findFirst` queries include `deletedAt: null`. Nested relations (bubbles, quickReplies) also filter `deletedAt: null`. ✅
- **Hardcoded secrets**: None found. ✅
- **SQL injection**: No unparameterized `$queryRaw`. ✅

### Warning

**W1 — Heavy `any` typing in `CannedResponseAdminPage.tsx` (18+ occurrences)**  
Pattern `api.get(...).then((r: any) => r.data)` appears throughout. The `axios` response type is `AxiosResponse<T>` and the API client already wraps it — these should use typed interfaces (`CannedResponse`, `Bubble`, etc.) instead of `as any`. While not a runtime issue, it bypasses TypeScript's protection and makes the code harder to safely refactor.

Affected patterns:
```ts
// common
api.get('/staff-chat/canned-responses?includeHidden=true').then((r: any) => r.data)
api.get(`/staff-chat/canned-responses/${id}/bubbles`).then((r: any) => r.data)
const newTpl: any = await api.post(...)
onError: (e: any) => toast.error(...)
```

**W2 — `StaffChatController` is now 808 lines**  
Exceeds the 500-line guideline. The new bubble/quick-reply CRUD endpoints (13 new routes) could be extracted into a `CannedResponseController` under the same `staff-chat` path prefix. Not blocking, but the file will be harder to review and navigate going forward.

**W3 — `MessageRouterService` is now 578 lines**  
Slightly over the 500-line guideline. Lower priority than W2.

**W4 — `formatDecimalThai` re-implements string formatting instead of using Prisma.Decimal API**  
The method uses `String(value)` + manual string parsing to format currency. Since `Prisma.Decimal.toString()` already gives the exact decimal string, `new Prisma.Decimal(String(value)).toFixed(2)` with a comma-grouping step would be more idiomatic. This is display-only (template variable substitution), so it carries no financial precision risk, but the custom implementation is worth noting.

### Info

**I1 — Cache invalidation is correct**  
`invalidate()` helper at the top of `CannedResponseAdminPage` invalidates both `canned-responses-admin` and `canned-responses-picker` query keys. All mutations call `invalidate()` on success. ✅

**I2 — Test coverage is good**  
New specs cover: bubble CRUD + max-5 guard, quick-reply CRUD, sender service (sendCannedResponse + channel routing), admin page integration tests (create/rename/delete categories), bubble reorder logic pure functions, MessageTemplatePicker unit tests. The controller spec overrides guards correctly in the test module.

**I3 — `let prisma: any` in test files**  
Acceptable for mock objects in spec files — does not affect production code.

**I4 — Docs added alongside code**  
`docs/superpowers/plans/2026-05-25-canned-response-admin-redesign.md` (1542 lines) and related specs are included in the branch. These are not production artifacts and do not need review, but they provide useful context.

---

## Recommendation

**APPROVE**

No critical or blocking issues found. The three Warning items are code-quality observations that can be addressed in follow-up without blocking the merge. The security posture is correct: guards, roles, soft-delete filters, and money-field handling all pass inspection.

**Suggested follow-up tasks (non-blocking):**
1. Add typed API response interfaces to `CannedResponseAdminPage.tsx` to replace `any` (W1)
2. Extract bubble/quick-reply CRUD from `StaffChatController` into a dedicated `CannedResponseController` (W2)
