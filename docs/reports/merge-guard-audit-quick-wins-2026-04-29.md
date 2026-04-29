# Merge Guard Report — `chore/audit-quick-wins`

**Date**: 2026-04-29  
**Branch**: `chore/audit-quick-wins`  
**Author**: Akenarin Kongdach  
**Commits ahead of main**: 2  
- `b42b7bb` perf(audit): dashboard staff metrics groupBy + 3 compound indexes  
- `b00d5ac` fix(security): throttle public endpoints + file upload validators  

---

## Branches Scanned

| Branch | Commits ahead | TS files changed | Action |
|--------|--------------|------------------|--------|
| `chore/audit-quick-wins` | 2 | 10 | **Reviewed below** |
| `chore/card-reader-paths-filter` | 18 | 0 | Skip — no diff vs main (changes already in main) |
| `chore/shop-phase3-followup` | 1925 | 0 | Skip — no diff vs main (diverged fork point) |
| `chore/trade-in-orchestrator-rebrand` | 1925 | 0 | Skip — no diff vs main (diverged fork point) |
| `claude/fix-contract-details-mismatch-rGvPp` | 1116 | 0 | Skip — no diff vs main |
| `claude/check-public-private-z6Yr7` | 1 | 0 | Skip — no diff vs main |
| All remaining branches | 1000+ | 0 | Skip — diverged, no new code |

---

## File Changes Summary

| File | Type | Change |
|------|------|--------|
| `apps/api/src/modules/customers/customers.controller.ts` | Security | Cap `limit` params at 100 (Math.min) |
| `apps/api/src/modules/dashboard/dashboard.service.ts` | Perf | Replace N+1 findMany → groupBy + batched user/branch lookups |
| `apps/api/src/modules/journal/journal.controller.ts` | Security | Cap `limit` param at 100 (Math.min) |
| `apps/api/src/modules/line-oa/broadcast.controller.ts` | Security | Add ParseFilePipe: MaxFileSizeValidator (10MB) + FileTypeValidator |
| `apps/api/src/modules/line-oa/line-oa.controller.ts` | Security | Add ParseFilePipe validators on 2 upload endpoints |
| `apps/api/src/modules/shop-auth-social/shop-auth-social.controller.ts` | Security | Add ShopBotDefenseGuard + @Throttle(5/min) + AbortSignal.timeout(10s) |
| `apps/api/src/modules/shop-installment-apply/shop-installment-apply.controller.ts` | Security | Add ShopBotDefenseGuard + @Throttle(5/min) on POST submit |
| `apps/api/src/modules/shop-me/shop-me.controller.ts` | Security | Replace `Record<string, unknown>` body with `ShippingAddressDto` + cap at 20 addresses |
| `apps/api/src/modules/shop-reservation/shop-reservation.controller.ts` | Security | Add ShopBotDefenseGuard + @Throttle(30/min) |
| `apps/api/src/modules/shop-tracking/shop-tracking.controller.ts` | Security | Add ShopBotDefenseGuard + @Throttle(30/min) on track endpoint |
| `apps/api/src/modules/staff-chat/web-widget.controller.ts` | Security | Add InitWidgetDto (MaxLength:64) + @Throttle on init/messages |
| `apps/api/prisma/schema.prisma` | Perf | 3 compound indexes: `[workflowStatus, updatedAt]`, `[relatedId, subject, sentAt]`, `[status, firstResponseAt, createdAt]` |
| `apps/api/prisma/migrations/20260426131551_add_audit_compound_indexes/migration.sql` | Perf | Idempotent `CREATE INDEX IF NOT EXISTS` for the 3 indexes above |

---

## Critical Issues

**None found.**

Checklist:
- [x] No missing `@UseGuards(JwtAuthGuard)` — shop-* controllers are customer-facing public endpoints, now protected by `ShopBotDefenseGuard` instead. This matches the intentionally-public pattern.
- [x] No `Number()` calls on financial fields — dashboard `totalSales` uses `new Prisma.Decimal().add().toNumber()` only for display-only dashboard metrics (not persisted).
- [x] No missing `deletedAt: null` — no new queries introduced; groupBy uses existing `baseWhere` which includes `deletedAt: null`.
- [x] No hardcoded secrets or API keys.
- [x] No missing `@Roles()` — shop-* controllers are public-facing, no role guard required.
- [x] No unparameterized `$queryRaw`.

---

## Warning Issues

**W-001 — `shop-auth-social.controller.ts` line ~41: No length/format validation on OAuth tokens before forwarding to external APIs**

The `code` (LINE) and `accessToken` (Facebook) values are passed directly to external API calls without validating length or format first. While the global `ValidationPipe` runs on the DTO, `LineLoginCallbackDto` and `FacebookLoginCallbackDto` should have `@MaxLength()` decorators to prevent forwarding unusually large payloads to LINE/Facebook.

```typescript
// Suggested fix in dto/social-login.dto.ts:
@IsString() @MaxLength(512) code!: string;
@IsString() @MaxLength(512) accessToken!: string;
```

**W-002 — `shop-me.controller.ts` line ~17: `addAddress` bypasses `@ValidateNested()` annotation**

`ShippingAddressDto` is used as the `@Body()` type. The global `ValidationPipe` with `transform: true` will validate it, but there is no `@ValidateNested()` + `@Type()` in place — which is the standard NestJS pattern for nested object validation. In this case the body *is* the DTO (not nested), so class-validator will validate it directly. This is actually correct behavior, but slightly non-obvious. No code change strictly needed, but worth confirming in review.

---

## Info Issues

**I-001 — `dashboard.service.ts` line ~659: `sellingSum` computed unconditionally but only used in `else` branch**

```typescript
const sellingSum = new Prisma.Decimal(a._sum.sellingPrice ?? 0).toNumber(); // computed always
if (existing) {
  // sellingSum unused here — re-derives from a._sum.sellingPrice directly
} else {
  staffMap.set(key, { totalSales: sellingSum, ... }); // used here only
}
```

Minor dead computation. No correctness issue. Could be moved inside the `else` block for clarity.

**I-002 — `broadcast.controller.ts`: `gif` image type allowed for broadcast upload**

`FileTypeValidator({ fileType: /^image\/(jpeg|png|gif|webp)$/ })` — GIF uploads are permitted for LINE broadcast images. Animated GIFs can be large; the 10MB cap mitigates this. Intentional or worth restricting to `jpeg|png|webp` only?

**I-003 — `dashboard.service.ts` is 700+ lines**

The file is large but the diff shows an improvement (fewer DB round-trips). Consider splitting `getStaffMetrics` into a separate service method in a future refactor.

---

## Recommendation

**APPROVE**

All changes are defensive security improvements — throttling public endpoints, file upload validation, bot defense guards, and OAuth timeout hardening. The performance improvement in `dashboard.service.ts` (groupBy replaces full-table-scan findMany) is correct and uses `Prisma.Decimal` appropriately.

Fix W-001 (add `@MaxLength` to OAuth token DTOs) before or shortly after merge — it is low-effort and plugs a minor attack surface. W-002 and the Info items are non-blocking.

The 3 compound indexes are idempotent (`IF NOT EXISTS`) and correctly target hot cron scan paths.

---

*Generated by Pre-Merge Guard — 2026-04-29*
