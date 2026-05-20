# Merge Guard Report — worktree-feat-shop-sales-ai-phase-a

**Date**: 2026-05-20  
**Branch**: `worktree-feat-shop-sales-ai-phase-a`  
**Author**: iamnaii (Akenarin Kongdach) `<akenarin.ak@gmail.com>`  
**Commits**: 37  
**Recommendation**: ⚠️ REVIEW

---

## File Changes Summary

```
36 files changed, 4315 insertions(+), 87 deletions(-)
```

### Key files modified
| File | Lines Added | Purpose |
|------|------------|---------|
| `apps/api/src/modules/sales-bot/tools/capture-lead.tool.ts` | +205 (new) | AI lead capture tool — creates Customer draft + PromptPay QR |
| `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts` | +157 | Auto-reply AI engine upgrade for SHOP Sales Bot |
| `apps/web/src/pages/AiSettingsPage.tsx` | +152 | AI settings UI — adds SHOP bot config section |
| `apps/web/src/pages/chat/components/RoomListItem.tsx` | +58 | Chat room list item with AI status indicators |
| `apps/web/src/pages/chat/components/AssistantSidebar.tsx` | +61 | AI assistant sidebar |
| `apps/api/src/modules/staff-chat/prompts/sales-persona.ts` | +83 | Sales persona prompt updates |
| `docs/plans/2026-05-20-shop-sales-ai-phase-a.md` | +2399 | Phase A implementation plan |

### New migrations (all safe — nullable columns only)
- `20260957000000_ai_auto_reply_logs_add_metadata` — adds `intent`, `tools_used`, `input_tokens`, `output_tokens` nullable columns
- `20260958000000_customer_acquisition_source` — adds nullable `acquisition_source TEXT` to `customers`
- `20260959000000_customer_acquisition_source_constraint` — tightens to `VARCHAR(50)` + partial index

---

## Issues by Severity

### ⚠️ Warning

#### W1 — `any` types in production React components (`AiSettingsPage.tsx`, `ChatInboxPage.tsx`)

Multiple untyped callbacks in `AiSettingsPage.tsx`:
```ts
// AiSettingsPage.tsx
api.get('/staff-chat/ai/settings').then((r: any) => {     // should be typed
queryFn: () => api.get('/branches').then((r: any) => r.data),  // should be typed
onSuccess: (res: any) => {                                // should type res
onError: (err: any) => {                                  // should type err as AxiosError
```

Same pattern in `ChatInboxPage.tsx`:
```ts
api.get('/staff-chat/ai/settings').then((r: any) => {
```

**Risk**: Silent type errors if API response shape changes; TypeScript loses coverage over the data flow.  
**Fix**: Define typed interfaces (e.g., `AiAutoSettingsResponse`) and replace `any` with them.

#### W2 — Missing Thai validation messages on new DTO fields

`UpdateAiSettingsDto` has 3 new `@IsString()` fields with no Thai `{ message: '...' }`:
```ts
@IsOptional()
@IsString()
shopBotCentralBranchId?: string;  // no Thai message
```

Existing fields in this DTO also lack messages — so this is consistent, but the backend rule requires Thai messages on new DTOs. The existing fields are a pre-existing gap; the new fields should not extend it.

**Fix**: Add `@IsString({ message: 'กรุณาระบุรหัสสาขากลาง' })` etc. to the 3 new fields.

---

### ℹ️ Info

#### I1 — `Number(input.downAmount ?? 0)` on a financial value

In `message-router.service.ts`:
```ts
downAmount: Number(input.downAmount ?? 0),
```

`downAmount` flows into `generatePayload(promptpayId, { amount: input.downAmount })` (PromptPay QR library) and `auditLog.newValue` JSON. It is **not written to a Prisma Decimal DB column** — so this is not the critical `Number()` money field pattern. However, JavaScript `number` type has precision limits (>2^53) and behaves as float. For down-payment amounts in Thai baht this is practically safe, but it diverges from the project's Decimal-first policy.

**Deferred risk**: If `downAmount` is later persisted to a DB money field without a Decimal cast, this becomes a bug. A comment noting "QR generation only, not persisted" would help future readers.

#### I2 — `AiSettingsPage.tsx` approaching 500-line limit

The file is 499 lines after this branch — just under the 500-line guideline. Adding any new sections will breach it. Consider splitting into `AiGeneralSettings.tsx` + `ShopBotSettings.tsx` sub-components.

#### I3 — `any` in test/spec files

`capture-lead.tool.spec.ts`, `ai-auto-reply.service.spec.ts`, `shop-ai-flow.unit.spec.ts` all use `let prisma: any` and `{} as any` for mocking. This is acceptable in test files but worth tracking for long-term maintainability.

---

## Security Checklist

| Check | Result |
|-------|--------|
| All new controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` | ✅ Pass |
| All new controller methods have `@Roles()` decorator | ✅ Pass |
| `Number()` on Prisma Decimal money fields | ✅ Pass (downAmount goes to QR only, not DB Decimal) |
| `deletedAt: null` present in all new Prisma queries | ✅ Pass |
| No hardcoded secrets or API keys | ✅ Pass |
| No unparameterized `$queryRaw` | ✅ Pass |
| `queryClient.invalidateQueries()` after mutations | ✅ Pass |
| New migrations safe for non-empty tables | ✅ Pass (all nullable/defaulted) |
| No raw `fetch()` in React components | ✅ Pass |

---

## Recommendation: ⚠️ REVIEW

**Block on**: Nothing (no Critical issues).  
**Fix before merge**:
- W1: Replace `any` types in `AiSettingsPage.tsx` and `ChatInboxPage.tsx` with typed interfaces
- W2: Add Thai validation messages to 3 new DTO string fields

**Nice-to-have**:
- I1: Comment on `downAmount` scope (QR-only, not persisted)
- I2: Plan to split `AiSettingsPage.tsx` before next feature addition
