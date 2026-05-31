# Pre-Merge Guard Report — feat/canned-response-admin-redesign

**Date**: 2026-05-31  
**Branch**: `feat/canned-response-admin-redesign`  
**Author**: Akenarin Kongdach  
**Recommendation**: ✅ APPROVE (3 Info notes)

---

## File Changes Summary

59 files changed — 8,203 insertions (+), 661 deletions (−)

### Backend (API)
| Area | Files | Description |
|------|-------|-------------|
| Prisma schema | `schema.prisma` + 3 migrations | `CannedResponseBubble`, `CannedResponseQuickReply` models; `BubbleType` enum |
| New DTOs | `create-bubble.dto.ts`, `update-bubble.dto.ts`, `create-quick-reply.dto.ts`, `update-quick-reply.dto.ts`, `update-canned-response.dto.ts` | Full class-validator coverage |
| New services | `canned-response-bubble.service.ts`, `canned-response-quickreply.service.ts`, `bubble-translator.service.ts` | Bubble/QR CRUD + channel-aware translate |
| Controller | `staff-chat.controller.ts` | 11 new endpoints for bubbles + quick-replies |
| Adapters | `line-finance.adapter.ts`, `line-shop.adapter.ts`, `facebook.adapter.ts` | Rich bubble dispatch |
| Specs | 6 new spec files | 280+ new tests |

### Frontend (Web)
| Area | Files | Description |
|------|-------|-------------|
| Page redesign | `CannedResponseAdminPage.tsx` | Full rewrite (669 lines, was monolithic) |
| New components | `CategoryTreePane`, `TemplateEditorPane`, `BubbleList`, `BubbleEditor`, `QuickReplyEditor`, `CategoryHeader`, `ChannelChips`, `TemplateItem` | Split from monolith |
| Bubble editors | 7 type-specific editors (`TextBubbleEditor`, `ImageBubbleEditor`, etc.) | Per-BubbleType UI |
| Picker | `MessageTemplatePicker.tsx` (replaces `CommandPalette.tsx`) | Template picker in chat UI |
| Logic | `reorder-logic.ts` | Isolated reorder utilities |
| Tests | `CannedResponseAdminPage.test.tsx`, `MessageTemplatePicker.test.tsx`, `reorder-logic.test.ts` | 62+197+75 = 334 new web tests |
| Docs | 4 spec/plan docs | Design + implementation docs |

---

## Issues Found

### Critical
None.

### Warning
None.

### Info

**I1 — `json?: any` TypeScript type in DTOs**  
Files: `create-bubble.dto.ts`, `update-bubble.dto.ts`

```ts
@IsOptional()
@IsObject()
json?: any;
```

The `json` field is stored as Prisma `Json?` (PostgreSQL `jsonb`). Runtime validation is present (`@IsObject()`), and the field is never passed to `$queryRaw` or `eval()`. The `any` type is a TypeScript-level concern — a future tightening to `Record<string, unknown>` would help. Low risk.

**I2 — Very large PR (8,203 lines, 59 files)**  
This is a significant feature addition that replaces the monolithic `CannedResponseAdminPage` and introduces rich bubble/QR models. The change is well-tested (334 new web tests + 6 new API spec files), but the scope warrants careful QA on:
- Multi-bubble send order in LINE and Facebook adapters
- Channel filter (`channels` array) edge cases (empty array = all channels)
- `CommandPalette.tsx` → `MessageTemplatePicker.tsx` replacement (verify feature parity in chat panel)

**I3 — `CommandPalette.tsx` deleted (200 lines)**  
Replaced by `MessageTemplatePicker.tsx` (421 lines) with `MessageTemplatePicker.test.tsx` covering the new component. The deletion removes the old `/` shortcut command palette. Confirm the new picker is wired into `ChatPanel.tsx` with equivalent UX.

---

## Guards & Patterns Check

| Check | Result |
|-------|--------|
| `StaffChatController @UseGuards` | ✅ Class-level `@UseGuards(JwtAuthGuard, RolesGuard)` |
| 11 new endpoints have `@Roles()` | ✅ All decorated (read = all roles, write = OWNER/BM) |
| No `Number()` on financial fields | ✅ Chat module — no money fields |
| No raw `fetch()` in frontend | ✅ All calls via `api.get()/api.post()/api.patch()/api.delete()` |
| `invalidateQueries` after mutations | ✅ `['canned-responses-admin']` + `['canned-responses-picker']` both invalidated |
| No hardcoded secrets | ✅ None found |
| `deletedAt: null` on SELECT queries | ✅ All `findMany`/`findFirst` include `deletedAt: null` |
| Update `where: { id }` (no deletedAt needed) | ✅ Consistent with reference module pattern |
| DTO Thai validation messages | ✅ Present on required fields |
| CSS design tokens | ✅ No hardcoded hex; uses semantic tokens |
| New models have `createdAt/updatedAt/deletedAt` | ✅ `CannedResponseBubble` + `CannedResponseQuickReply` both have all 3 |
| Migration uses descriptive names | ✅ 3 separate focused migrations |
| Decimal for money | ✅ N/A (chat module) |
