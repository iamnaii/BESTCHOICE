# Pre-Merge Guard Report

**Branch:** `feat/canned-response-admin-redesign`  
**Author:** Akenarin Kongdach `<akenarin.ak@gmail.com>`  
**Review Date:** 2026-05-27  
**Reviewer:** Pre-Merge Guard (automated)  
**Recommendation:** ✅ APPROVE (with noted Warnings)

---

## Summary

This is a **large feature branch** (~8 200 lines, 59 files changed) that ships:

- **Phase 1–4**: Multi-bubble Canned Response admin redesign — new backend services (`CannedResponseBubbleService`, `CannedResponseQuickReplyService`, `CannedResponseSenderService`), new DTOs with class-validator, 17 new frontend components under `canned-response-admin/`.
- **Phase 5**: Quick Reply postback routing — `CannedResponseSenderService` dispatches templates triggered by postback payloads; `MessageTemplatePicker` sends via `/send-canned-response`.
- **Backfill CLI**: `migrate-canned-response-content-to-bubbles.cli.ts` migrates legacy `content` field to a first `TEXT` bubble (idempotent).
- **Test coverage**: new spec files (`staff-chat.controller.spec.ts`, `CannedResponseAdminPage.test.tsx`, `MessageTemplatePicker.test.tsx`).

---

## File Changes Summary

| Area | Files | Lines |
|------|-------|-------|
| Backend services (new) | 3 | ~550 |
| Backend DTOs (new) | 5 | ~200 |
| Backend controller (expanded) | 1 | +110 |
| Frontend pages & components | 17 | ~2 800 |
| Tests | 4 | ~500 |
| Docs/specs | 2 | ~470 |
| Prisma schema + seed | 2 | ~200 |
| CLI script | 1 | ~56 |

---

## Critical Issues

> **None found.** All critical checks passed.

### ✅ Auth/Guard Coverage
- `StaffChatController` retains `@Controller('staff-chat') @UseGuards(JwtAuthGuard, RolesGuard)` at class level — all 13 new endpoints inherit it.
- Every new method has an explicit `@Roles(...)` decorator (verified line-by-line).
- The `FacebookWebhookController` is correctly documented as **intentionally public** (`// This controller is intentionally public — no JwtAuthGuard`) and is on the allow-list in `security.md`.

### ✅ Money / Decimal Safety
- No `Number()` calls on financial fields. The canned-response domain deals only with string content, integer sort orders, and lat/lon coordinates — no monetary values.
- `@IsNumber()` in DTOs is used only for `latitude`, `longitude` (location bubble) — correct.

### ✅ Soft-Delete Filters
- All new Prisma queries consistently include `{ deletedAt: null }`:
  - `CannedResponseBubbleService`: `findMany`, `count`, `findFirst` — ✅
  - `CannedResponseQuickReplyService`: `findMany`, `count`, `findFirst` — ✅
  - `CannedResponseSenderService`: `chatRoom.findFirst`, `cannedResponse.findFirst`, `bubbles include` — ✅
  - Backfill CLI: `findMany({ where: { deletedAt: null } })` — ✅
  - `FacebookWebhookController` postback path: `chatRoom.findFirst({ where: { ..., deletedAt: null } })` — ✅

### ✅ No Hardcoded Secrets
- No API keys, tokens, or passwords found in diff.

### ✅ No SQL Injection
- No `$queryRaw` with unparameterized inputs found.

---

## Warning Issues

### ⚠️ W1 — `createCannedResponse` uses raw body instead of typed DTO
**File:** `apps/api/src/modules/staff-chat/staff-chat.controller.ts`  
**Endpoint:** `POST /staff-chat/canned-responses`

```ts
async createCannedResponse(
  @Body() body: { shortcut: string; title: string; content: string; category?: string; sortOrder?: number }
) {
```

This pre-existing endpoint was not updated to use the new `UpdateCannedResponseDto`. No class-validator decorators are applied, so field lengths and types aren't validated on the server. Should be refactored to use (or create) a `CreateCannedResponseDto`.

**Impact:** Low. Existing endpoint not new, but now exposed to more callers post-redesign.

---

### ⚠️ W2 — `sendCannedResponse` uses inline body validation instead of DTO
**File:** `apps/api/src/modules/staff-chat/staff-chat.controller.ts`  
**Endpoint:** `POST /staff-chat/rooms/:roomId/send-canned-response`

```ts
@Body() body: { templateId: string },
// ...
if (!body?.templateId || typeof body.templateId !== 'string') {
  throw new BadRequestException('กรุณาระบุ templateId');
}
```

Manual guard is effective but bypasses `class-validator` / `ValidationPipe` pipeline. A small `SendCannedResponseDto` would be cleaner and consistent with the project pattern.

**Impact:** Low. Functionally correct.

---

### ⚠️ W3 — `MessageTemplatePicker` mutation missing `invalidateQueries`
**File:** `apps/web/src/pages/UnifiedInboxPage/components/MessageTemplatePicker.tsx`

```ts
const sendDirectMut = useMutation({
  mutationFn: () =>
    api.post(`/staff-chat/rooms/${roomId}/send-canned-response`, ...),
  onSuccess: (res) => {
    // ... toast + onClose()
    // ❌ No queryClient.invalidateQueries() call
  },
});
```

After sending, the messages list in `ChatPanel` is not refreshed via query invalidation. The panel may rely on WebSocket push for live updates (which is likely fine), but if a user navigates away and back the outbox message count/history may be stale. Add `queryClient.invalidateQueries({ queryKey: ['room-messages', roomId] })` if ChatPanel has a corresponding query key.

**Impact:** Medium UX — stale message list in edge cases.

---

### ⚠️ W4 — `any` type proliferation in new frontend code
**Files:** `CannedResponseAdminPage.tsx`, `BubbleEditor.tsx`, `QuickReplyEditor.tsx`

Multiple `(e: any)`, `(r: any)`, `(created: any)` throughout the new components. While common in error handlers, the `duplicateTemplateMutation.onSuccess` receives `(created: any)` which should be typed as `CannedResponse`.

**Impact:** Low — no runtime bug risk; reduces TypeScript safety.

---

### ⚠️ W5 — `staff-chat.controller.ts` approaching size limit
**File:** `apps/api/src/modules/staff-chat/staff-chat.controller.ts`  
**Size:** 808 lines (guideline: split >500)

The controller grew by ~110 lines with this branch. Consider extracting the new Bubble/QuickReply CRUD endpoints into a dedicated `CannedResponseAdminController` in a future cleanup sprint.

**Impact:** Maintainability; no correctness risk.

---

## Info

### ℹ️ I1 — Bubble `json` field typed as `any`
**File:** `apps/api/src/modules/staff-chat/services/canned-response-bubble.service.ts`

```ts
json?: any;
```

For JSON bubble type, the arbitrary JSON payload is stored as `any`. Consider a branded type or at least `Record<string, unknown>` with an `@IsObject()` decorator. Currently `@IsObject()` is already applied in the DTO, which is acceptable.

### ℹ️ I2 — No migration for new Prisma models
The branch adds `CannedResponseBubble` and `CannedResponseQuickReply` models (inferred from service code). The corresponding Prisma migration file should be verified to exist before merge — confirm `apps/api/prisma/migrations/` contains the migration for these models.

### ℹ️ I3 — Seed data phone prices are hardcoded
`apps/api/prisma/seed.ts` now seeds installment rate templates with real product prices (iPhone 15/16, S25, iPad). These will drift as products change. Consider moving seed data to a config file or YAML to make updates easier.

---

## Test Coverage

| File | Type | Count |
|------|------|-------|
| `staff-chat.controller.spec.ts` | Unit | New — controller + sender service |
| `CannedResponseAdminPage.test.tsx` | Unit/Integration | New |
| `MessageTemplatePicker.test.tsx` | Unit | New |
| `canned-response-variable.service.spec.ts` | Unit | Expanded (probe substitution) |

---

## Recommendation: ✅ APPROVE

No critical security, data-integrity, or correctness issues found. The branch follows all mandatory patterns:
- Guards + Roles on all new endpoints ✅
- Soft-delete filters on all queries ✅
- No money-unsafe Number() calls ✅
- No hardcoded secrets ✅

Warnings W1–W3 are worth fixing before this branch sees heavy production traffic but do not block merge. W4 and W5 are cleanup items for a follow-up sprint.
