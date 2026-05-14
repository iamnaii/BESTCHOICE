# Merge Guard Report — fix/other-income-v2-1-review-followup

**Date**: 2026-05-14  
**Branch**: `fix/other-income-v2-1-review-followup`  
**Author**: Akenarin Kongdach  
**Commits ahead of combined base**: 7 unique commits (3 on top of combined, 4 CI fixes)  
**Files changed vs combined**: ~20 TS/TSX files  
**Recommendation**: ✅ APPROVE

---

## Summary

Post-merge review followup for `feat/other-income-v2-1-combined`. Fixes:
- TOCTOU race on `approve()` and `reject()` — switched to CAS-`updateMany`
- Role consistency on Maker-Checker endpoints
- Thai error messages added/corrected on DTOs
- Test expectations updated to match Thai messages
- Validation rule renumbering (T4 — docs only)

---

## Issues Found

### Critical — None

| Check | Result |
|-------|--------|
| New controllers missing `@UseGuards` | ✅ No new controllers — changes are on existing guarded controller |
| Missing `@Roles` decorators | ✅ All new endpoints (`/maker-checker`, `/request-approval`, `/approve`, `/reject`, `/templates/*`) have `@Roles` |
| `Number()` on money fields | ⚠️ See W1 below |
| Missing `deletedAt: null` | ✅ No new findMany/findFirst on soft-deletable models |
| Hardcoded secrets | ✅ None |
| SQL injection | ✅ None |

### Warning — 1 item

**W1 — Template DTO financial fields use `number`, not `Decimal`**  
File: `apps/api/src/modules/other-income/dto/create-template.dto.ts`  
`TemplateItemDto.unitAmount`, `.discountAmount`, `.vatPct`, `.whtPct` are declared as `number` (JavaScript float). These values are stored as JSON in `otherIncomeTemplate.itemsJson` (not a `@db.Decimal` column) and later used to prefill the Other Income entry form. Floating-point imprecision could propagate into form state for amounts that aren't exactly representable in IEEE 754 (e.g. 33.33% VAT, 1.5% WHT).

**Mitigation**: The actual OtherIncome document and journal entries use `Prisma.Decimal`. Templates are a convenience prefill, not a computation source. Risk is display-level only. Recommend annotating with a comment or converting to string-based storage in a follow-up.

### Info — 1 item

**I1 — `RequestApprovalDto` is empty**  
`apps/api/src/modules/other-income/dto/request-approval.dto.ts` has no fields ("Empty body — no fields required"). This is intentional and correct — approval request carries no payload. No action needed.

---

## Positive Highlights

- **CAS approve/reject** (`updateMany({ where: { id, status: READY } })`) is the correct atomic pattern — prevents race conditions when two OWNERs approve simultaneously. ConflictException on CAS miss is user-friendly Thai error.
- **Maker ≠ Approver** check correctly enforced at the service layer, not the DTO layer (right place — requires DB read).
- **All new DTOs** (ApproveOtherIncomeDto, RejectOtherIncomeDto, CreateTemplateDto, UpdateTemplateDto) have Thai validation messages.
- **`template-vars.util.ts`**: safe string replacement using regex with global flag; no injection vectors — replacement values are hardcoded Thai month/year strings, not user input.
- **`replaceVariables`** correctly handles `{เดือนปี}` before `{เดือน}` to prevent partial-match substitution.
