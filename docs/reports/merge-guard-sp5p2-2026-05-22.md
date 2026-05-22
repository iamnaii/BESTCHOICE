# Merge Guard Report — SP5 Phase 2 Insurance Branches
**Date**: 2026-05-22  
**Reviewed by**: Pre-Merge Guard Agent  
**Main tip**: `d956d46f` fix(sales-bot): search_products returns priceMissing flag (#1069)

---

## Scope

574 remote branches exist. Of those, 3 branches have unreleased commits relative to current main and were updated within the last 72 hours. All other recently-updated branches (e.g. `fix/soften-price-missing`, `feat/persona-no-data-rule`, `fix/search-products-stock-and-price`) were confirmed **already squash-merged** to main as PRs #1062–#1069.

---

## Branches Reviewed

### 1. `feat/sp5p2-warranty-endpoints`
- **Commits unique to branch**: 5
- **Last commit**: 2026-05-20 11:23:29 +0700
- **Intent**: Add `warrantyPreview` + `warrantyLookup` endpoints to `repair-tickets` for SP5 Phase 2 insurance wizard
- **Files changed**: ~45 files across api + prisma

### 2. `feat/sp5p2-wizard`
- **Commits unique to branch**: 10
- **Last commit**: 2026-05-20 10:44:11 +0700
- **Intent**: Add `CreateInsuranceWizardPage` (steps 1-4) + wire `/insurance/new` route
- **Files changed**: ~55 files across api + web

### 3. `feat/sp5p2-warranty-check-unify`
- **Commits unique to branch**: 6
- **Last commit**: 2026-05-20 11:29:13 +0700
- **Intent**: Add `WarrantyCheckPage` at `/insurance/warranty-check`, unify sidebar `/insurance` entry point, SP5 Phase 2 final cleanup
- **Files changed**: ~48 files across api + web

---

## File Changes Summary (per branch vs current main)

All three branches share the same conflict surface against main because they diverged from a common ancestor **before** PRs #1056–#1069 were merged (AI Phase A work, 2026-05-14 to 2026-05-21). The repair-ticket/insurance feature code is layered on top of the pre-AI-Phase-A main state.

Key files regressed by all three branches (relative to current main):

| File | Action vs Main | Merged-to-main via |
|---|---|---|
| `sales-bot/tools/search-products.tool.ts` | REVERT to `costPrice` | #1068, #1069 |
| `sales-bot/tools/calculate-installment.tool.ts` | REVERT to `costPrice` | #1068 |
| `sales-bot/providers/gemini.provider.ts` | DELETE (368 lines) | #1057 |
| `sales-bot/providers/claude.provider.ts` | DELETE (122 lines) | #1056 |
| `sales-bot/providers/llm-provider.registry.ts` | DELETE (78 lines) | #1056 |
| `sales-bot/providers/llm-provider.interface.ts` | DELETE (64 lines) | #1056 |
| `sales-bot/sales-bot.service.ts` | -246 lines (reverts grounding guard + multi-provider) | #1067 |
| `staff-chat/services/persona.service.ts` | DELETE (136 lines) | #1061 |
| `staff-chat/services/ai-auto-reply.service.ts` | -290 line diff | #1055–#1056 |
| `cli/shop-ai-bench.cli.ts` | DELETE (371 lines) | #1048 |

---

## Issues Found

### 🔴 CRITICAL — Must fix before merge (all three branches)

#### C1: Reverts `costPrice → ProductPrice` fix (#1068) in sales-bot tools

**Branch**: All three  
**Files**:
- `apps/api/src/modules/sales-bot/tools/search-products.tool.ts`
- `apps/api/src/modules/sales-bot/tools/calculate-installment.tool.ts`

**What the branch adds**:
```typescript
// search-products.tool.ts (branch version — REVERTED)
select: { costPrice: true },
priceThb: Number(r.costPrice),  // ← uses wholesale cost as selling price

// calculate-installment.tool.ts (branch version — REVERTED)
select: { costPrice: true, name: true },
const price = Number(product.costPrice);  // ← same
```

**Why it's critical**: This is exactly the bug that caused the "iPhone 15 ราคา 7,000 บาท" hallucination incident (2026-05-21). `costPrice` is the wholesale purchase price, not the customer-facing `ProductPrice`. Merging would reopen the data-integrity vulnerability for the SHOP Sales AI bot — the bot would again quote wholesale costs as selling prices. PR #1068 (now in main) fixed this by joining the `prices` table with `isDefault: true`.

#### C2: Deletes dual-LLM provider abstraction (Gemini + Claude providers)

**Branch**: All three  
**Files deleted from branch**:
- `gemini.provider.ts` (368 lines, adds Gemini 2.5-flash support)
- `claude.provider.ts` (122 lines)
- `llm-provider.registry.ts` (78 lines, runtime provider switching)
- `llm-provider.interface.ts` (64 lines, interface contract)

**Why it's critical**: PRs #1056–#1058 added multi-LLM support. These branches predate that work and would delete the entire abstraction. The UI toggle for provider switching (SystemConfig `SALES_BOT_PROVIDER`) would silently break if these files are deleted.

#### C3: Removes anti-hallucination grounding guard (sales-bot.service.ts)

**Branch**: All three  
**File**: `apps/api/src/modules/sales-bot/sales-bot.service.ts` (branch removes 246 lines vs main)

**Why it's critical**: PR #1067 added `guardGrounding()` — a programmatic price-hallucination backstop that blocks any LLM reply mentioning a price not seen in tool results. The branch's version of `sales-bot.service.ts` predates this guard entirely.

#### C4: Deletes persona editor service (persona.service.ts)

**Branch**: All three  
**File**: `apps/api/src/modules/staff-chat/services/persona.service.ts` (136 lines deleted)

**Why it's critical**: PR #1061 added owner-editable bot persona via SystemConfig. Deleting `persona.service.ts` would 500-error any call to `AiSettingsController`'s persona endpoints since the service is injected there.

---

### 🟡 WARNING — Should fix before merge

#### W1: `Number()` on Decimal money field (costPrice proxy — consequence of C1)

**Branch**: All three  
**File**: `search-products.tool.ts`, `calculate-installment.tool.ts`

`Number(r.costPrice)` where `costPrice` is `@db.Decimal(12,2)` — loses precision and uses the wrong value. This is the same violation that rules/database.md prohibits ("ห้ามใช้ Float หรือ Int สำหรับจำนวนเงิน"). The fix (PR #1068) already resolves this by using `ProductPrice.amount` via the `prices` relation.

#### W2: Stale Firebase hosting cache file committed

**Branch**: All three  
**File**: `.firebase/hosting.YXBwcy93ZWIvZGlzdA.cache` — 322-line deletion (branch removes it; main has it from a prior deploy)

Low-risk but indicates the branch state is stale relative to the deployment pipeline.

---

### 🔵 INFO

#### I1: Repair-tickets controller and service — clean

The core insurance/repair-tickets feature code itself is well-implemented:
- Controller: `@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)` at class level ✅
- All 11 route methods have `@Roles(...)` ✅
- Service: `deletedAt: null` in every `findMany`/`findFirst`/`findUnique` ✅
- Service: No `Number()` on Decimal money fields (comment explicitly notes "actualCost is Prisma.Decimal from DB — passed through unchanged") ✅
- No hardcoded secrets or unparameterized `$queryRaw` ✅

#### I2: Missing `warrantyLookup` pagination

`GET /repair-tickets/warranty-lookup` returns up to 5 contracts (`take: 5`) for a given customer/IMEI/contract query — no `page`/`total` response shape. Not a security issue but inconsistent with the standard pagination contract (`{ data, total, page, limit }`).

#### I3: New E2E specs guard correctly against pre-merge environment

All 4 E2E smoke tests in `insurance-warranty-check.spec.ts` use `gotoWithRetry` + graceful skip (`test.skip`) when the page isn't available — won't break CI on the main branch build.

---

## Root Cause of All Critical Issues

**All three branches diverged from main at commit `131e539c` (before 2026-05-14)** — which predates the entire AI Phase A (#1048–#1069) sprint. When rebased to current main (`d956d46f`), the SP5P2 insurance feature code will merge cleanly because the only repair-tickets files modified are:
- `repair-tickets.controller.ts` (new endpoints)
- `repair-tickets.service.ts` (new `warrantyPreview`/`warrantyLookup`)
- `repair-tickets.module.ts`
- `dto/*.ts`

None of these conflict with the AI Phase A changes. The conflicts are all in `sales-bot/`, `staff-chat/`, `ai-settings/` files that were touched by both the SP5P2 branch (pre-AI-Phase-A version) and main (post-AI-Phase-A).

---

## Recommendation

| Branch | Verdict | Required action |
|---|---|---|
| `feat/sp5p2-warranty-endpoints` | 🔴 **BLOCK** | Rebase on `d956d46f` (current main) — resolve conflicts in `sales-bot/` and `staff-chat/` files by keeping the main versions |
| `feat/sp5p2-wizard` | 🔴 **BLOCK** | Same — rebase required |
| `feat/sp5p2-warranty-check-unify` | 🔴 **BLOCK** | Same — rebase required |

### Rebase guidance

```bash
# For each branch:
git checkout feat/sp5p2-warranty-endpoints
git rebase origin/main

# Expected conflicts — accept main's version for:
# - sales-bot/tools/search-products.tool.ts     → keep main (ProductPrice fix)
# - sales-bot/tools/calculate-installment.tool.ts → keep main (ProductPrice fix)
# - sales-bot/sales-bot.service.ts              → keep main (grounding guard)
# - staff-chat/services/persona.service.ts      → keep main (don't delete)
# - sales-bot/providers/gemini.provider.ts      → keep main (don't delete)
# - sales-bot/providers/claude.provider.ts      → keep main (don't delete)
# - sales-bot/providers/llm-provider.*.ts       → keep main (don't delete)
```

Once rebased, the repair-ticket/insurance feature changes should apply cleanly and will then be safe to merge.

---

## Non-reviewed branches (out of scope)

- `feat/ai-relocate-and-24-7` (174 unique commits) — large feature, no merge candidate currently
- 560 other remote branches — all confirmed as either (a) squash-merged to main already, (b) pre-PR staging branches, or (c) guard/watchdog/docs report branches
