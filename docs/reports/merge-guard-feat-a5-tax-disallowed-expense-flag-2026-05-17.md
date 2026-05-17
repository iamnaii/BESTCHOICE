# Merge Guard Report — feat/a5-tax-disallowed-expense-flag

**Date**: 2026-05-17  
**Branch**: `feat/a5-tax-disallowed-expense-flag`  
**Author**: Akenarin Kongdach  
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

14 files changed, 719 insertions(+), 61 deletions(-)

| File | Change |
|------|--------|
| `apps/api/prisma/schema.prisma` | Added `taxDisallowed Boolean @default(false)` to `ExpenseDocument` + `ExpenseLine` |
| `apps/api/prisma/migrations/*/migration.sql` | Migration with `ALTER TABLE ... ADD COLUMN tax_disallowed BOOLEAN NOT NULL DEFAULT FALSE` |
| `apps/api/src/modules/expense-documents/dto/create.dto.ts` | Added `@IsBoolean() @IsOptional() taxDisallowed?` |
| `apps/api/src/modules/expense-documents/dto/expense-line-input.dto.ts` | Added `@IsBoolean() @IsOptional() taxDisallowed?` per-line |
| `apps/api/src/modules/expense-documents/expense-documents.controller.ts` | New `GET /expense-documents/tax-disallowed` endpoint |
| `apps/api/src/modules/expense-documents/expense-documents.service.ts` | `getTaxDisallowedSummary()`, persistence in `create()` + `update()` |
| `apps/api/src/modules/expense-documents/__tests__/expense-documents.controller.spec.ts` | Updated controller tests |
| `apps/api/src/modules/expense-documents/__tests__/tax-disallowed.service.spec.ts` | New 201-line service spec |
| `apps/web/src/App.tsx` | New lazy route `/accounting/tax-disallowed-summary` |
| `apps/web/src/pages/accounting/TaxDisallowedSummaryPage.tsx` | New page (170 lines) |
| `apps/web/src/components/expense-form-v4/ExpenseFormV4.tsx` | Checkbox for doc-level flag |
| `apps/web/src/components/expense-form-v4/ItemLinesSection.tsx` | Per-line toggle |
| `apps/web/src/components/expense-form-v4/VendorSection.tsx` | Minor updates |
| `apps/web/src/components/expense-form-v4/types.ts` | Added `taxDisallowed` to TS types |

---

## Issues by Severity

### Critical — None

**Guards**: New `GET /expense-documents/tax-disallowed` carries `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT')`. Controller class retains `@UseGuards(JwtAuthGuard, RolesGuard)` ✓

**Money fields**: `getTaxDisallowedSummary()` uses `this.prisma.expenseDocument.aggregate()` returning `Prisma.Decimal`, computed with `.plus()` and returned via `.toFixed(2)`. No `Number()` coercion on financial values ✓  
The one `Number()` call (`Number(ymd.slice(0, 4))`) extracts a 4-digit year from a date string — not a financial amount ✓

**Soft-delete**: `getTaxDisallowedSummary` where clause includes `deletedAt: null` ✓

**Secrets**: None ✓

**SQL injection**: No raw `$queryRaw` — uses typed Prisma aggregate ✓

### Warning — 1

**W1 — No `queryClient.invalidateQueries` needed but confirm there are no stale-write paths**  
`TaxDisallowedSummaryPage` is read-only (`useQuery` only, no mutations), so no invalidation is required. However, the expense form checkboxes in `ExpenseFormV4.tsx` do trigger mutations — confirm the existing `invalidateQueries(['expense-documents'])` in that form already covers the new `taxDisallowed` field. If the summary page is open in another tab while a doc is updated, it may show stale data until the TTL expires. This is cosmetic, not a correctness issue.

### Info — 2

**I1 — Migration is backwards-compatible**  
`BOOLEAN NOT NULL DEFAULT FALSE` on existing rows — safe for `prisma migrate deploy` with live data ✓ No two-step migration needed.

**I2 — New page not yet linked from sidebar/nav**  
`/accounting/tax-disallowed-summary` is accessible by direct URL but has no nav link. This is expected for Phase A.5 feature-flagged rollout; confirm intentional.

---

## Recommendation: APPROVE

Solid implementation. Security posture is correct, Decimal arithmetic is used throughout, schema migration is backwards-compatible, and the frontend follows established patterns (lazy load, `ProtectedRoute`, React Query, `api.get()`). No issues block merge. Address W1 (stale-data UX) in a follow-up if the page is shown alongside active expense editing.
