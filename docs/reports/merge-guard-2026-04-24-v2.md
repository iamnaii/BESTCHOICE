# Pre-Merge Guard Report — 2026-04-24 (v2)

**Reviewed by**: Pre-Merge Guard Agent  
**Date**: 2026-04-24  
**Branches reviewed**: 3 (most recently updated, not yet in v1 report)

---

## Summary

| Branch | Files Changed | Commits | Recommendation |
|--------|--------------|---------|---------------|
| `fix/customer-intake-bank-statement-pdf` | 7 | 1 | ✅ APPROVE |
| `fix/intake-full-step-add-missing-fields` | 2 | 1 | ⚠️ REVIEW |
| `fix/liff-sync-customer-lineid` | 2 | 1 | ✅ APPROVE |

---

## Branch 1: `fix/customer-intake-bank-statement-pdf`

**Author**: Akenarin Kongdach  
**Commit**: `fix(ocr): bank-statement รับ PDF + หลายไฟล์ (customer-intake stuck)`  
**Files** (7):
- `apps/api/src/modules/ocr/dto/ocr.dto.ts` (+12/-4)
- `apps/api/src/modules/ocr/ocr.controller.ts` (+1/-1)
- `apps/api/src/modules/ocr/ocr.service.ts` (+92/-8)
- `apps/web/e2e/customer-intake-pdf-upload.spec.ts` (+211, new)
- `apps/web/src/components/credit-check/useCreditCheckCreate.ts` (+16/-4)
- `apps/web/src/lib/compressImage.ts` (+29)
- `apps/web/src/pages/CustomerIntakePage/components/PreCheckUploadStep.tsx` (+55/-20)

### Change Summary

Upgrades the bank-statement OCR endpoint to accept an array of files (`filesBase64: string[]`) instead of a single `imageBase64: string`. Adds PDF support — PDFs are passed to Claude as `document` content blocks; images remain compressed JPEG. Adds drag-and-drop to the upload zone. Adds 3 E2E specs verifying the new request shape and UI behaviour.

**Key backend changes**:
- `OcrBankStatementDto`: `imageBase64: string` → `filesBase64: string[]` with `@IsArray`, `@ArrayMinSize(1)`, `@ArrayMaxSize(10)`, `@IsString({ each: true })`, `@MaxLength(15_000_000, { each: true })`. All messages in Thai. ✅
- New `validateFileBase64()` method validates media-type prefix (JPEG/PNG/GIF/WebP/PDF) and base64 charset before passing to Claude.
- New `callClaudeOcrMultiFile()` + `callClaudeOcrMultiFileWithRetry()` paralleling the existing single-file retry logic.
- Timeout increased 90 s → 120 s to account for multi-file calls.

**Key frontend changes**:
- New `fileToOcrBase64(file)` in `compressImage.ts`: images → compressed JPEG, PDFs → raw data URL, other types throw.
- Drag-and-drop on the upload zone; `isDragging` state gives visual feedback.
- `Input` for bankName changed from `readOnly` → editable (disabled only while OCR is running) — users can type bank name if OCR fails.

### Issues Found

**Critical**: None

**Warning**:
- `@MaxLength(15_000_000, { each: true })` allows 15 MB per base64 string × up to 10 files = up to 150 MB of string data in a single request body. The existing throttle (`@Throttle({ short: { limit: 5, ttl: 60000 } })`) limits burst rate, but a sustained stream of max-size requests could create memory pressure. Recommend adding a total-size guard (sum of all elements) or lowering the per-file cap to ~12 MB (≈ 8.5 MB binary). Not a blocker given throttling.

**Info**:
- `PreCheckUploadStep.tsx` converts the upload button from `<button>` to `<div role="button">`. Keyboard handlers (`Enter`/`Space`) are wired correctly, so accessibility is maintained. Native `<button>` is preferred per project convention but this is a minor point.
- E2E test uses `page.waitForResponse('**/ocr/bank-statement', { timeout: 10000 })` — the route is mocked so response is instant; 10 s is sufficient.

### Recommendation: ✅ APPROVE

Clean implementation. DTO validation is correct and complete. `validateFileBase64()` properly rejects unsupported media types. The warning about total request size is advisory — throttle provides sufficient guard for now.

---

## Branch 2: `fix/intake-full-step-add-missing-fields`

**Author**: Akenarin Kongdach  
**Commit**: `feat(customer-intake): เพิ่มที่อยู่ + ชื่อเล่น/วันเกิด/Facebook link`  
**Files** (2):
- `apps/web/src/pages/CustomerIntakePage/components/FullIntakeStep.tsx` (+175/-36)
- `apps/web/src/pages/CustomerIntakePage/types.ts` (+6)

### Change Summary

Adds several previously missing form fields to the Full Intake step:
- **Personal**: nickname, birthDate (already in types + Prisma + DTO — now exposed in UI)
- **Contact**: separate `facebookLink` URL field (was merged with `facebookName`)
- **Addresses**: `addressIdCard`, `addressCurrent` (with "same as ID card" toggle), `addressCurrentType` (OWN/RELATIVE/RENT), `addressWork`, `googleMapLink` — all wired to the `AddressForm` component with `serializeAddress`/`deserializeAddress`
- Minor: prettier reformatting of reference inputs

All new fields exist in `UpdateCustomerDto` (`customer.dto.ts`) and in `schema.prisma`, so they will persist correctly through the API → Prisma → DB pipeline.

### Issues Found

**Critical**: None

**Warning**:
- `facebookLink` and `googleMapLink` are rendered as `<Input type="url">`, which gives browser-native URL validation. However, `UpdateCustomerDto` only applies `@IsString()` — an invalid URL (e.g. `"not-a-url"`) would pass server-side validation and be persisted. Consider adding `@IsUrl({ require_protocol: true }, { message: 'ลิงก์ไม่ถูกต้อง' })` to both fields in the DTO.
- After `saveMut` succeeds, `onDone` calls `intake.goTo('done')` — no `queryClient.invalidateQueries()` for the customer query. If the parent page displays customer data read from the React Query cache, it will show stale data until the next fetch. In the current intake wizard flow this is acceptable (wizard advances to 'done'), but worth tracking if the component is later reused in an edit context.
- `<input type="checkbox" className="rounded border-input text-primary ...">` is a raw HTML input — project convention requires shadcn/ui `<Checkbox>` for consistency and dark-mode correctness.

**Info**:
- `sameAddress` effect syncs `addressCurrent` whenever `addressIdCard` changes while the checkbox is checked — correct behaviour.
- All new `FullIntakeForm` fields were already in `types.ts` on `main`; this branch only makes them visible in the UI.

### Recommendation: ⚠️ REVIEW

No blockers. Three warnings: (1) missing URL validation on facebook/map links in the DTO — minor data quality risk; (2) no cache invalidation (low impact in current flow); (3) raw `<input>` instead of shadcn `<Checkbox>`. Can merge after owner acknowledges or quick-fixes the DTO validators.

---

## Branch 3: `fix/liff-sync-customer-lineid`

**Author**: Akenarin Kongdach  
**Commit**: `fix(liff): sync customer.lineId ใน bind() + backfill migration`  
**Files** (2):
- `apps/api/prisma/migrations/20260422090000_backfill_customer_lineid_from_link/migration.sql` (+16, new)
- `apps/api/src/modules/chatbot-finance/services/verification.service.ts` (+8)

### Change Summary

Root-cause fix for LIFF pages showing "ไม่มีสัญญา" even after a customer links via the Finance chatbot.

**Problem**: `VerificationService.bind()` created a `CustomerLineLink` record and updated `chatRoom.customerId`, but never wrote `lineId` on the `Customer` row itself. LIFF pages (`/liff/contract`, etc.) look up contracts using `customer.lineId` directly — so the link was invisible to them.

**Fix**: Inside the existing `$transaction`, add one more `customer.update({ lineId: lineUserId })` after the `CustomerLineLink` is created.

**Migration**: Backfills `customers.line_id` from `customer_line_links` where channel = `FINANCE` and not unlinked, only for rows where `line_id` is currently null/empty. Idempotent.

### Security Check

`VerificationService.bind()` is part of the `chatbot-finance-liff` module — intentionally public (no `JwtAuthGuard`), authenticated via LINE LIFF token instead. This is documented in `.claude/rules/security.md` as an approved exception. The fix does not open any new unauthenticated surface. ✅

### Issues Found

**Critical**: None  
**Warning**: None  
**Info**:
- Migration touches potentially many rows in production if many customers have linked via chatbot Finance. The `WHERE (c.line_id IS NULL OR c.line_id = '')` condition keeps it idempotent and safe to re-run. Low risk; standard backfill pattern.

### Recommendation: ✅ APPROVE

Minimal, correct, well-commented fix. Migration is safe and idempotent. No security concerns.

---

## Overall

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Warning | 5 (across 2 branches) |
| Info | 4 |

All three branches can merge once the ⚠️ REVIEW items on `fix/intake-full-step-add-missing-fields` are acknowledged. The two `fix/*` branches are clean approvals.
