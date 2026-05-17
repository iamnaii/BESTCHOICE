# Merge Guard Report — feat/a1-d1.1.2.5-doc-number-admin-reset

**Date:** 2026-05-17  
**Branch:** `feat/a1-d1.1.2.5-doc-number-admin-reset`  
**Recommendation:** ⚠️ REVIEW

---

## File Changes Summary

| File | Change | Lines |
|------|--------|-------|
| `apps/api/src/modules/settings/dto/reset-doc-number.dto.ts` | New | +27 |
| `apps/api/src/modules/settings/settings.controller.ts` | Modified | +22 |
| `apps/api/src/modules/settings/settings.service.spec.ts` | Modified | +54 |
| `apps/api/src/modules/settings/settings.service.ts` | Modified | +65 |
| `docs/superpowers/tracking/D1-settings-implement.md` | Modified | tracking update |

**Total:** 5 files changed, 168 insertions(+), 2 deletions(−)

---

## Issues Found

### Critical — 0 issues

None.

### Warning — 1 issue

**W1 — `groupBy` query missing `deletedAt: null` filter**  
File: `apps/api/src/modules/settings/settings.service.ts`, `resetDocSequence()` method (~line 272)

```ts
const maxRows = await this.prisma.expenseDocument.groupBy({
  by: ['documentType'],
  _max: { number: true },
  // ⚠️ missing: where: { deletedAt: null }
});
```

Soft-deleted documents are included in the `MAX(docNumber)` diagnostic snapshot. Since the endpoint is read-only / diagnostic (no sequence mutation), this won't cause data corruption. However:
- The snapshot value will be misleading if the latest document in a type was soft-deleted (e.g. owner deleted a duplicate `EX-20260510-0042`).
- The reported MAX will be higher than the actual last-issued number, confusing the diagnostic output.

**Suggested fix:** Add `where: { deletedAt: null }` to the `groupBy` call.

### Info

- The endpoint is a well-scoped **diagnostic stub** — it explicitly does not mutate any sequence and documents this clearly in both code comments and the returned `note` field. Good transparency.
- DTO uses `@IsEnum(DocumentType)` and `@IsISO8601` with Thai error messages ✅
- `@Roles('OWNER')` on the new endpoint; controller class already has `@UseGuards(JwtAuthGuard, RolesGuard)` + class-level `@Roles('OWNER')` ✅
- `AuditLog` written with `action: 'DOC_SEQUENCE_RESET'` for traceability ✅

---

## Detailed Findings

### Security
- New `POST /settings/doc-number/reset` endpoint:
  - Controller class: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('OWNER')` ✅
  - Method: `@Roles('OWNER')` (redundant but harmless) ✅
  - No SQL injection — uses Prisma typed API ✅
  - No hardcoded secrets ✅
  - No money/financial fields involved ✅

### Architecture
- The stub design (diagnostic-only, no mutation) is the right forward-compatibility approach for D1.1.2.4's planned `DocumentSequence` table migration ✅
- `resetDocSequence` correctly iterates all `DocumentType` enum values to ensure every key appears in `currentMaxByType` even with no rows ✅
- 4 unit tests cover the main scenarios: MAX snapshot, audit write, note content, and all-5-keys presence ✅

---

## Recommendation: REVIEW

One Warning: the `groupBy` diagnostic query should filter `deletedAt: null` to avoid reporting soft-deleted document numbers as the current max. Since this is diagnostic-only (no mutations), it does not block merge — but the fix is trivial and improves accuracy. Author should address before merge or add a code comment acknowledging the intentional inclusion of soft-deleted rows.
