# Merge Guard Report — feat/canned-response-admin-redesign

**Date**: 2026-05-27  
**Branch**: `feat/canned-response-admin-redesign`  
**Author**: Akenarin Kongdach <iamnaii@MacBook-Pro-khxng-Akenarin.local>  
**Commit**: docs(canned-response): add spec + plan for admin redesign + rich content  

---

## File Changes Summary

| Category | Files | +/- |
|----------|-------|-----|
| Prisma schema + migrations | 4 | +153 / 0 |
| API services (new) | 5 | +636 / 0 |
| API services (modified) | 3 | +299 / -100 |
| API controller + module | 2 | +241 / -98 |
| API DTOs | 5 | +240 / 0 |
| Frontend pages + components (new) | 22 | +2,760 / 0 |
| Frontend pages (modified) | 4 | +708 / -561 |
| Test files | 7 | +1,093 / 0 |
| Spec/plan docs | 4 | +2,799 / 0 |
| Seed + CLI | 2 | +110 / -2 |

**Total**: 59 files changed, 8,203 insertions, 661 deletions

---

## Architecture Assessment

This is a large but well-structured feature addition that:

1. **Adds two new Prisma models** — `CannedResponseBubble` (multi-content bubbles per template) and `CannedResponseQuickReply` (quick reply buttons), both with proper UUID PKs, soft-delete (`deletedAt`), composite indexes, and `onDelete: Cascade` (appropriate — bubbles have no meaning without the parent template)
2. **Introduces three dedicated services** — `CannedResponseBubbleService`, `CannedResponseQuickReplyService`, `BubbleTranslatorService` — cleanly separating concerns
3. **Guards are correct** — All new endpoints in `StaffChatController` are under the existing `@UseGuards(JwtAuthGuard, RolesGuard)` class-level decorator, and every new method has `@Roles(...)`. No unguarded endpoints introduced.
4. **Soft-delete filter is present** in every new `findMany` / `findFirst` query (`deletedAt: null`)
5. **No financial money fields** — latitude/longitude use `Float` (correct for geo coordinates, not money)
6. **No hardcoded secrets**
7. **No raw SQL** (`$queryRaw` / `$executeRaw`) — all queries are Prisma ORM calls
8. **Frontend patterns correct** — uses `useQuery`/`useMutation` from `@tanstack/react-query`, `api.get()`/`api.post()` from `@/lib/api`, `toast` from sonner, mutations include `onSuccess` with `invalidateQueries`

---

## Issues by Severity

### 🔴 Critical
None.

### 🟡 Warning

**W1 — Several `@MaxLength` validators missing Thai `message:` strings in `CreateBubbleDto`**  
File: `apps/api/src/modules/staff-chat/dto/create-bubble.dto.ts`

```ts
@MaxLength(2000)           // mediaUrl — no Thai message
mediaUrl?: string;

@MaxLength(2000)           // thumbnailUrl — no Thai message
thumbnailUrl?: string;

@MaxLength(50)             // stickerPackageId — no Thai message
stickerPackageId?: string;

@MaxLength(50)             // stickerId — no Thai message
stickerId?: string;
```

Compare with the correctly-messaged fields:
```ts
@MaxLength(5000, { message: 'text ยาวเกิน 5000 ตัวอักษร' })   // ✅
@MaxLength(20, { message: 'label ยาวเกิน 20 ตัวอักษร' })       // ✅ (CreateQuickReplyDto)
```

Project convention per `.claude/rules/backend.md`: "Error messages เป็นภาษาไทย". These validators return default English messages on failure.

**Recommendation**: Add Thai `message:` to all `@MaxLength` and `@IsNumber`/`@IsString` validators missing them.

---

**W2 — `json?: any` field in `CreateBubbleDto` has no size limit**  
File: `apps/api/src/modules/staff-chat/dto/create-bubble.dto.ts`

```ts
@IsOptional()
@IsObject()
json?: any;
```

The `json` field (used for CARD/VIDEO/JSON bubble types) is validated only as an object — no depth limit, no size cap. A user with OWNER/BRANCH_MANAGER access could store an arbitrarily large JSON payload. While access is restricted, this could affect DB row size or serialization performance.

**Recommendation**: Add a size check (e.g., validate serialised length before upsert in the service), or document that the UI enforces a reasonable cap.

---

**W3 — `any` types in adapter service**  
File: `apps/api/src/modules/chat-adapters/facebook.adapter.ts` (modified)

```ts
private cardToFbGenericTemplate(card: any): Record<string, unknown>
card.buttons.slice(0, 3).map((b: any) => { ... })
```

The CARD bubble translation in the Facebook adapter uses untyped `any`. If the shape of a stored CARD JSON diverges from what the adapter expects, the runtime error won't be caught at compile time.

**Recommendation**: Define an interface for the CARD bubble shape and use it here. Even a minimal `{ title: string; imageUrl?: string; buttons?: { type: string; label: string; url?: string; payload?: string }[] }` would catch obvious mismatches.

---

**W4 — `sendDirectMut` in `MessageTemplatePicker` has no error boundary display**  
File: `apps/web/src/pages/UnifiedInboxPage/components/MessageTemplatePicker.tsx`

```ts
const sendDirectMut = useMutation({
  mutationFn: () => api.post(`/staff-chat/rooms/${roomId}/send-canned-response`, ...),
  onSuccess: (res: any) => {
    const errors: string[] = data?.errors ?? [];
    if (errors.length > 0) {
      toast.error(`ส่งสำเร็จ ${sent}/${sent + errors.length} bubble — บาง bubble ล้มเหลว`);
    }
    // ...
  },
  // ❌ No onError handler
```

If the API call itself throws (network error, 500), the mutation silently fails — no toast, no user feedback.

**Recommendation**: Add an `onError` handler:
```ts
onError: (e: any) => toast.error(`ส่งไม่สำเร็จ: ${e?.response?.data?.message ?? 'กรุณาลองใหม่'}`),
```

---

### 🔵 Info

**I1 — Three new migrations look correct**  
The three migrations add `CannedResponseBubble`, `CannedResponseQuickReply`, and new enum types. All new tables — no backfill issues. `onDelete: Cascade` on both tables is appropriate. `@@index([cannedResponseId, sortOrder])` on both is good for `ORDER BY sortOrder` queries.

**I2 — `MessageTemplatePicker.tsx` is 421 lines**  
Borderline but under the 500-line Info threshold. The component handles preview + direct-send + search + grouping logic — splitting further would add prop-drilling complexity. Acceptable.

**I3 — `CannedResponseAdminPage.tsx` was refactored from a monolith to 381 lines**  
The page component went from 660+ lines to 381 lines by extracting `CategoryTreePane`, `TemplateEditorPane`, `BubbleList`, `QuickReplyEditor` etc. into the `canned-response-admin/` directory. This is a positive structural improvement.

**I4 — Test coverage is solid**  
New service specs cover bubble CRUD, quick reply CRUD, bubble translation per channel, and sender integration (280 tests across 5 spec files). `CannedResponseAdminPage.test.tsx` adds 62 unit tests. Good coverage for the surface area introduced.

**I5 — `CommandPalette.tsx` deleted (200 lines)**  
The `CommandPalette` component is removed from `UnifiedInboxPage` and replaced by `MessageTemplatePicker`. Ensure no other page imports `CommandPalette` before merging.

---

## Recommendation

**🟡 REVIEW**

This is a well-engineered feature with no critical security or correctness bugs. The four warning items are genuine issues that should be addressed before merge:

| # | Issue | Priority |
|---|-------|----------|
| W1 | Thai messages missing on CreateBubbleDto validators | Medium |
| W2 | `json` field needs size safeguard | Medium |
| W3 | `any` types in card-to-FB-template translation | Low |
| W4 | `sendDirectMut` missing `onError` handler | Medium |

Once W1, W2, and W4 are fixed (W3 can follow), this branch is ready to merge. The architectural foundation (models, services, controller guards, soft-delete patterns) is solid and follows established project conventions correctly.
