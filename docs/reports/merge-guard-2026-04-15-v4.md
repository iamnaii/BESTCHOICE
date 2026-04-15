# Pre-Merge Guard Report — 2026-04-15 (v4)

Generated: 2026-04-15  
Guard base: `origin/main` @ `d57382fe`  
Branches reviewed: 3 (top by recency, excluding previous guard branches)

---

## Branch 1: `fix/hardening-non-accounting`

**Author**: Akenarin Kongdach `<iamnaii@MacBook-Pro-khxng-Akenarin.local>`  
**Last commit**: 2026-04-14 22:59 +0700  
**Tip**: `16a18376 feat(chat): complete Phase 2 — WS events, file upload, read receipts, KB suggestions`

### Commits unique to this branch (above `feat/chatbot-production-ready`)

| SHA | Message |
|-----|---------|
| `16a18376` | feat(chat): complete Phase 2 — WS events, file upload, read receipts, KB suggestions |
| `17c1c9f9` | fix: hardening — security, DTOs, FINANCE_MANAGER, SMS retry, Dashboard MoM |

### File changes summary

- **22 files, 198 ins / 64 del** (commit 17c1c9f9)
- **12 files, 480 ins / 217 del** (commit 16a18376)
- Key files: `chatbot-finance-liff.controller.ts`, `staff-chat.controller.ts`, `staff-chat.gateway.ts`, `session-manager.service.ts`, `assignment.service.ts`, `handoff-manager.service.ts`, `ChatbotFinanceKnowledgePage.tsx`, `UnifiedInboxPage/index.tsx`

---

### Issues Found

#### Critical

None.

#### Warning

**W-001 — File type validator regex is incomplete (staff-chat upload endpoint)**  
`apps/api/src/modules/staff-chat/staff-chat.controller.ts` (commit 16a18376)

```ts
new FileTypeValidator({ fileType: /^(image\/(jpeg|png|webp)|application\/pdf|application\/(msword|vnd\.openxmlformats))/ }),
```

The last alternative `application/(msword|vnd\.openxmlformats)` matches **any** MIME type beginning with `application/vnd.openxmlformats` — not just the full docx MIME (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`). A client could submit `application/vnd.openxmlformats-ANYTHING` and bypass the intent of the filter.

**Fix**: Use a full anchored pattern:

```ts
fileType: /^(image\/(jpeg|png|webp)|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/
```

---

**W-002 — Staff file upload saved as `MessageRole.BOT` instead of `MessageRole.STAFF`**  
`apps/api/src/modules/staff-chat/staff-chat.controller.ts` (commit 16a18376)

```ts
await this.sessionManager.saveMessage({
  sessionId,
  role: MessageRole.BOT,   // ← wrong
  ...
  staffId: userId,
});
```

The `MessageRole` enum has a `STAFF` value. Using `BOT` for staff-uploaded files will cause incorrect attribution in message history and analytics. The `staffId` field is set correctly but the role is semantically wrong.

**Fix**:

```ts
role: MessageRole.STAFF,
```

---

#### Info

**I-001 — `sessionId` in S3 key not validated as UUID**  
`apps/api/src/modules/staff-chat/staff-chat.controller.ts` (commit 16a18376)

```ts
const key = `staff-chat/${sessionId}/${Date.now()}${ext}`;
```

`sessionId` comes from `@Param('id')` without `ParseUUIDPipe`. While JWT + role guards prevent unauthenticated requests, a authenticated user with a malformed sessionId (e.g., `../../../etc`) could create unexpected S3 key paths. Risk is low given S3's key isolation, but aligning with the pattern used elsewhere is recommended.

**Fix**: Add `@Param('id', ParseUUIDPipe)` or validate that the session belongs to the caller before writing.

---

**I-002 — `ChatbotFinanceKnowledgePage.tsx` is 603 lines**  

The file grew to 603 lines in this branch. Consider splitting into `KnowledgeTab`, `SuggestionsTab`, and `SystemPromptTab` sub-components for maintainability.

---

### Positive Security Changes (commit 17c1c9f9)

- **LiffTokenGuard added** to `ChatbotFinanceLiffController` — `lineUserId` is now verified server-side via LINE API instead of being trusted from the request body. This closes a P0 impersonation vulnerability.
- **Webhook rawBody guard** — `LineFinanceWebhookGuard` now rejects webhooks without `rawBody` in production (falls back gracefully in dev).
- **19 `@Roles` decorators updated** to include `FINANCE_MANAGER` across 5 controllers.
- **DTO validation added** for 5 new DTOs (`LiffNotificationPreferencesDto`, `SlipUploadBodyDto`, `ApproveEvidenceDto`, `BatchApproveEvidenceDto`, `BatchRejectEvidenceDto`) with Thai error messages.
- **Real-time WS events** wired via `IChatGateway` interface pattern — avoids circular deps cleanly.
- **KB Suggestions mutations** properly call `queryClient.invalidateQueries()` after approve/reject.

### Recommendation

**REVIEW** — Fix W-001 (file type regex) and W-002 (MessageRole.BOT → STAFF) before merge. These are not security-critical but are correctness bugs that will cause problems in production.

---

## Branch 2: `feat/chatbot-production-ready`

**Author**: iamnaii `<akenarin.ak@gmail.com>`  
**Last commit**: 2026-04-14 23:02 +0700 (approx)  
**Tip**: `a068ba27 fix(chatbot): fallback to hardcoded prompt when DB fails`

### Commits unique to this branch (above merged chatbot ultraplan base)

| SHA | Message |
|-----|---------|
| `a068ba27` | fix(chatbot): fallback to hardcoded prompt when DB fails |
| `a4f8b94e` | feat(chatbot): production-ready — feedback Quick Reply, admin prompt editor, KB seed, remove CHATCONE |

### File changes summary

- ~15 files, new services: `finance-config.service.ts`, `knowledge.service.ts`, `prisma/seeds/knowledge-base.ts`
- Key new endpoints: `POST /admin/knowledge/seed`, `GET/PUT/POST /admin/prompt`

---

### Issues Found

#### Critical

None.

#### Warning

None.

#### Info

**I-003 — Admin seed endpoint is idempotent but not rate-limited**  
`POST /chatbot/finance/admin/knowledge/seed` — guarded by OWNER/FINANCE_MANAGER, idempotent by design, but no `@Throttle` decorator. A rapid sequence of calls could cause unnecessary DB writes. Low priority given the role restriction.

---

### Positive Security Changes

- All new admin endpoints (`/admin/prompt`, `/admin/knowledge/seed`) are guarded with `JwtAuthGuard + RolesGuard` and limited to `OWNER` or `OWNER + FINANCE_MANAGER`.
- DB-fallback to hardcoded prompt avoids service outage when `FinanceConfig` row is missing.
- Removal of unused CHATCONE stub module reduces attack surface.

### Recommendation

**APPROVE** — No blocking issues. Clean implementation with proper guards.

---

## Branch 3: `chore/quickbuy-step1-reorder`

**Author**: iamnaii `<akenarin.ak@gmail.com>`  
**Last commit**: 2026-04-08 15:26 +0700  
**Tip**: `58871078 ui(trade-in): reorder Step 1 fields ตามฟอร์มข้อมูลลูกค้า + ขยายช่องอัปโหลดบัตร`

### Commits unique to this branch (above main)

| SHA | Message |
|-----|---------|
| `58871078` | ui(trade-in): reorder Step 1 fields + expand ID card upload area |

### File changes summary

- **1 file, 28 ins / 21 del**: `apps/web/src/components/trade-in/QuickBuyModal.tsx`
- Pure UI reorder: ชื่อ → เลขบัตร → เบอร์ → ที่อยู่ → รูปบัตร (single-column flow)

---

### Issues Found

#### Critical

None.

#### Warning

None.

#### Info

None.

---

### Recommendation

**APPROVE** — Pure presentational change. No backend, no API calls, no state logic changed. Safe to merge.

---

## Summary Table

| Branch | Recommendation | Critical | Warning | Info |
|--------|---------------|----------|---------|------|
| `fix/hardening-non-accounting` | **REVIEW** | 0 | 2 | 2 |
| `feat/chatbot-production-ready` | **APPROVE** | 0 | 0 | 1 |
| `chore/quickbuy-step1-reorder` | **APPROVE** | 0 | 0 | 0 |

## Action Required Before Merging `fix/hardening-non-accounting`

1. **W-001**: Fix `FileTypeValidator` regex in `staff-chat.controller.ts` — use anchored full MIME pattern
2. **W-002**: Change `role: MessageRole.BOT` → `role: MessageRole.STAFF` in the upload endpoint

Both fixes are small, targeted, and low-risk. No architecture changes needed.
