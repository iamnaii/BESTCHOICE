# CTO Watchdog Report — 2026-05-04

## Summary
10/15 checks passed (4 WARN, 1 FAIL) — one critical Decimal precision regression and missing FK indexes need attention before next release.

---

## A. Code Health

| Check | Status | Details |
|-------|--------|---------|
| A1 TypeScript Errors | **PASS** | 0 errors in `apps/api` and `apps/web` (both `tsc --noEmit` clean) |
| A2 Security | **WARN** | See notes below |
| A3 Decimal Compliance | **FAIL** | 125 `Number()` casts on Decimal money fields across 10+ services |
| A4 Soft-Delete | **PASS** | No `findMany`/`findFirst` calls missing `deletedAt: null` guard found |
| A5 Tests | **WARN** | API 2284/2285 passed (1 seed-spec DB-connectivity failure); Web 222/222 |
| A6 Bundle Size | **PASS** | No chunks >500 KB gzip; largest: `excel` 256 KB, `pdf` 139 KB, `charts` 119 KB |

### A2 — Security Details

**localStorage (WARN):**
`apps/web/src/lib/api.ts:10` reads `localStorage.getItem('access_token')` for Playwright E2E
test support. The token is removed immediately after reading and is never set by production
code. **Not gated by `import.meta.env.DEV`** — a developer manually setting this key in
production localStorage would briefly obtain a stored token. Low risk, but should be gated:

```ts
// Suggested fix — add env guard:
if (import.meta.env.DEV) {
  const e2eToken = localStorage.getItem('access_token');
  ...
}
```

**Raw SQL (`$queryRaw`) — PASS:**
9 usages found. All use Prisma tagged template literals (e.g., `` $queryRaw`SELECT 1` ``,
`` $queryRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint)` ``). Prisma automatically
parameterizes tagged templates — no injection risk. No `$queryRaw(Prisma.raw(...))` pattern
found.

**Hardcoded secrets — PASS:** None found.

**Unguarded controllers — PASS:** All controllers have `@UseGuards(JwtAuthGuard, RolesGuard)`
except the documented public list (chatbot-finance-liff, sms-webhook, paysolutions, address,
health, shop/public-config).

### A3 — Decimal Compliance Details

125 `Number()` casts on money-related Decimal fields. Notable high-risk locations:

| File | Lines | Fields |
|------|-------|--------|
| `chatbot-finance/services/finance-tools.service.ts` | 53–54, 108 | `amountDue`, `amountPaid` (chatbot calculation path) |
| `line-oa/chatbot.service.ts` | 151–215 | `amountDue`, `amountPaid` (multiple reduce + display) |
| `sales/sales.service.ts` | 286, 579 | `costPrice` |
| `asset/asset.service.ts` | 173, 214, 340 | `costValue`, `salvageValue` (depreciation arithmetic) |
| `customers/customers.service.ts` | 1100 | `_sum.amountDue` (outstanding total) |
| `stickers/stickers.service.ts` | 67–68 | `amount`, `costPrice` |
| `shop-catalog/shop-catalog.service.ts` | 93, 134 | `_min.costPrice` |
| `staff-chat/services/chat-commerce.service.ts` | 132–134, 220, 255 | `amountDue`, `amountPaid`, `prices[].amount` |
| `line-oa/line-oa-payment.controller.ts` | 129–130, 519 | `amountMin/Max` filter bounds |
| `shop-orders/online-order-sale.adapter.ts` | 52 | `totalAmount` |

`Number()` on a Prisma `Decimal` causes silent floating-point rounding (e.g., 1999.99 may
become 1999.9899999...). Arithmetic on these values — especially in the chatbot calculation
path and depreciation — can produce incorrect results. Must use `Prisma.Decimal` for
arithmetic or defer `.toNumber()` to the serialization boundary only.

### A5 — Failing Test Details

```
FAIL apps/api/src/modules/overdue/__tests__/collections-foundation.seed.spec.ts
Error: connect ECONNREFUSED 127.0.0.1:5432
```

Seed spec calls live `prisma.user.upsert()` without mocking the DB client. It passes in CI
where a DB is available but fails in environments without one. This is a test-isolation issue,
not a regression. **Does not affect the 2284 other passing tests.**

---

## B. Database Health

| Check | Status | Details |
|-------|--------|---------|
| B1 Schema Best Practices | **WARN** | `PromiseSlot` missing `deletedAt`; Float on GPS coords acceptable |
| B2 Migration Health | **PASS** | 196 migrations; latest descriptive; no DROP TABLE/COLUMN in recent 5 |
| B3 Index Coverage | **WARN** | 20+ models missing FK indexes on frequently-queried fields |
| B4 Schema Drift | **PASS** | Latest migration (pgvector HNSW) matches schema intent; no mismatches |

### B1 — Schema Details

**Money fields — PASS:** All financial fields use `@db.Decimal(12, 2)`. Zero `Float` on money
columns. (`Signature.gpsLatitude/gpsLongitude` use `Float` — correct for GPS coordinates.)

**Enum naming — PASS:** All enums are PascalCase names with SCREAMING_SNAKE_CASE values.

**UUID IDs — PASS:** All models use `@id @default(uuid())`.

**Timestamps — WARN:**
- `PromiseSlot` (v5): has `createdAt` + `updatedAt` but **no `deletedAt`**. Added in v5 without
  documented exception reason. If soft-delete is not intended (e.g., slots are cascade-deleted
  with their CallLog), add a `/// Cascade-deleted with CallLog — deletedAt omitted` comment.

All other models audited (Customer, DunningRule, Promotion, FeeWaiverApproval) confirmed to
have correct timestamps. Earlier scan false-positives were due to schema parser regex behavior
on large models.

### B3 — Missing FK Indexes (Priority Order)

High-traffic models requiring immediate attention:

| Model | Missing Indexes | Impact |
|-------|----------------|--------|
| `Contract` (105 fields) | `productId`, `reviewedById`, `interestConfigId` | Contract queries by product are O(n) |
| `Repossession` | `contractId`, `productId` | Repossession list/search unindexed |
| `CallLog` | `yeastarCallId` | Yeastar call lookup is full-table scan |
| `User` (124 fields) | `employeeId`, `lineId` | User-by-employee lookup slow |
| `PurchaseOrder` | `createdById`, `approvedById` | PO audit queries slow |
| `DailyAssignment` | `contractId`, `paymentId` | Assignment lookup by contract unindexed |
| `MdmLockRequest` | `proposedById`, `approvedById` | MDM audit trail slow |

Lower priority (less frequent queries):
`StockAdjustment.adjustedById`, `GoodsReceivingItem.productId`, `StockTransfer.confirmedById`,
`Signature.staffUserId`, `ContractLetter.contractId`, `ProductPhoto.productId/uploadedById`.

---

## C. Chatbot Health

| Check | Status | Details |
|-------|--------|---------|
| C1 AI Service | **OK** | `claude-sonnet-4-6` ✓; `MAX_TOOL_ITERATIONS=5` ✓; `maxTokens=1024` ✓; Sentry captures ✓ |
| C2 Prompt Quality | **OK** | Prompt matches constants; bank/phone/hours consistent; no contradictions |
| C3 Tool Definitions | **OK** | 7 tools defined with Thai descriptions; executor handles all 7 names; customerId injected by orchestrator |
| C4 Auto-Trigger | **OK** | T-5/T-3/T-1/T (09:00) + T+1/T+3 (10:00) all covered; `ChatAutoTrigger` idempotency; Sentry on both crons |
| C5 Security | **OK** | LIFF: `LiffTokenGuard` ✓; Admin: `JwtAuthGuard+RolesGuard` ✓; `WebhookDedupService.isDuplicate()` ✓; `customerId` injected server-side ✓ |

### C2 — Prompt Consistency Check

| Constant | finance-rules.ts | system-prompt.ts |
|----------|-----------------|-----------------|
| Bank | ธนาคารกสิกรไทย 203-1-16520-5 | Same ✓ |
| Account name | บจก. เบสท์ช้อยส์โฟน | Same ✓ |
| Phone | 063-134-6356 | Same ✓ |
| Hours | Mon–Sat 09:00–18:00 | Same ✓ |
| Late fee | 50 บาท/วัน | Same ✓ |

### C3 — Tool Coverage

Tools defined in `tool-definitions.ts` and handled in `tool-executor.ts`:
`get_current_balance`, `get_payment_schedule`, `calculate_fine`, `list_recent_receipts`,
`get_bank_info`, `search_knowledge_base`, `handoff_to_human` — all 7 have matching `case`
branches. No orphaned definitions.

---

## Action Items

### P0 — Fix Before Next Deploy

**[A3] Decimal precision loss in 10+ services**
Replace `Number()` casts on Prisma `Decimal` fields with proper `Prisma.Decimal` arithmetic
or move `.toNumber()` to serialization boundaries only. Highest-risk paths:

1. `chatbot-finance/services/finance-tools.service.ts:53–54,108` — chatbot calculates customer
   balance using `Number()`, can show wrong amounts to customers
2. `asset/asset.service.ts:173,214,340` — depreciation arithmetic compounding rounding errors
3. `customers/customers.service.ts:1100` — `_sum.amountDue` cast loses precision on totals

---

### P1 — Fix This Sprint

**[B3] Add FK indexes on Contract, Repossession, CallLog**
Most impactful (high-read tables). Create one Prisma migration:

```prisma
// Contract
@@index([productId])
@@index([reviewedById])

// Repossession
@@index([contractId])
@@index([productId])

// CallLog
@@index([yeastarCallId])
```

**[A5] Fix seed spec DB isolation**
Mock `prisma.user.upsert()` in `collections-foundation.seed.spec.ts` to remove hard
dependency on live database. Test suite count should be 2285/2285.

---

### P2 — Before Next Major Release

**[A2] Gate E2E localStorage behind `import.meta.env.DEV`**
`apps/web/src/lib/api.ts:8–13` — wrap the E2E token read in a dev-only guard.

**[B1] Document PromiseSlot.deletedAt omission**
Add `/// Cascade-deleted with CallLog — deletedAt intentionally omitted` comment to
`PromiseSlot` model in `schema.prisma`, or add `deletedAt DateTime?` if soft-delete
is needed for v5 promise lifecycle queries.

**[B3] Add remaining FK indexes (lower priority models)**
`User.employeeId/lineId`, `PurchaseOrder.createdById/approvedById`, `DailyAssignment.contractId`,
`MdmLockRequest.proposedById/approvedById`.

---

## Environment Snapshot

| Metric | Value |
|--------|-------|
| Date | 2026-05-04 |
| API TS errors | 0 |
| Web TS errors | 0 |
| API tests | 2284 pass / 1 fail (196 suites) |
| Web tests | 222 pass / 0 fail (24 files) |
| Migrations | 196 |
| Bundle largest gzip | 256 KB (excel) |
| Model: AI chatbot | claude-sonnet-4-6 |
