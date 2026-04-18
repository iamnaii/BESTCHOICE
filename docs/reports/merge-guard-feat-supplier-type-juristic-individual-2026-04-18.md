# Merge Guard Report — feat/supplier-type-juristic-individual

**Date**: 2026-04-18
**Branch**: `feat/supplier-type-juristic-individual`
**Author**: Akenarin Kongdach (last commit 2026-04-18 15:44)
**Base**: `origin/main`

## File Changes Summary

7 files changed, 321 insertions(+), 68 deletions(−)

Commits (1):
- `feat(suppliers): distinguish นิติบุคคล vs บุคคลธรรมดา with type-specific fields`

Key changes:
- `apps/api/prisma/schema.prisma` — new `SupplierType` enum (`INDIVIDUAL | JURISTIC`), adds `type`, `titleName`, `branchCode` to `Supplier` model
- Migration `add_supplier_type` — additive `ALTER TABLE` with `DEFAULT 'JURISTIC'` (backfill-safe)
- `create-supplier.dto.ts` / `update-supplier.dto.ts` — new fields with class-validator + Thai messages
- `SupplierForm.tsx` — conditional form fields based on type (branchCode for JURISTIC/VAT, titleName for INDIVIDUAL)
- `SupplierTable.tsx` / `SuppliersPage/index.tsx` — display type badge, pass type in payload

---

## Issues by Severity

### Critical — 0 issues

- No new controllers without `@UseGuards` ✅
- No `Number()` on money fields ✅
- No missing `deletedAt: null` (no new queries introduced) ✅
- No hardcoded secrets ✅
- No unparameterized `$queryRaw` ✅

### Warning — 0 issues

- DTO validations have Thai error messages ✅ (`'ประเภทผู้ขายไม่ถูกต้อง'`, `'รหัสสาขาต้องเป็นตัวเลข 5 หลัก'`)
- `saveMutation` and `toggleActiveMutation` both call `queryClient.invalidateQueries({ queryKey: ['suppliers'] })` in `onSuccess` ✅
- Uses `api.post` / `api.patch` from `@/lib/api` — no raw `fetch()` ✅
- Uses `useQuery` / `useMutation` from `@tanstack/react-query` ✅

### Info — 2 items

**I-001**: `branchCode` field: the DTO validates `@Matches(/^\d{5}$/)` but the schema stores it as `TEXT` with no DB-level constraint. This means manually-inserted rows or future migration paths bypass the validation. Low risk given only the NestJS API writes to this column.

**I-002**: For INDIVIDUAL suppliers `hasVat` is forced to `false` in the frontend payload:
```ts
hasVat: isIndividual ? false : formData.hasVat,
```
This is not enforced server-side — the DTO does not cross-validate `type === INDIVIDUAL → hasVat === false`. A direct API call could set an INDIVIDUAL supplier as `hasVat: true`. Consider adding a class-validator `@ValidateIf` constraint or service-level check if tax correctness is critical.

---

## Recommendation

**APPROVE**

Clean, minimal feature addition. Migration is safe (additive with default, no data loss). DTOs are properly validated with Thai messages. Frontend conditionally shows/hides fields correctly and uses proper React Query patterns. No security or precision issues.

**Optional improvement** (not blocking): Add server-side validation `if (dto.type === 'INDIVIDUAL') dto.hasVat = false` in the suppliers service to enforce the business rule via API as well.
