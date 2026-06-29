# Pre-Merge Guard Report — 2026-06-29

**Run time**: 2026-06-29 UTC  
**Branches scanned**: 4 (2 newly-fetched worktree branches + 2 chore branches already APPROVED 2026-06-28)  
**Author**: Akenarin Kongdach (all branches)

---

## Context: Two Histories in One Repo

The `iamnaii/bestchoice` repository contains **two unrelated git histories**:

| History | Commits | Latest tip |
|---------|---------|------------|
| `main` | 229 | `9b96234a` — Merge feat/payment-history-receipt-view |
| `worktree-*` branches | 2500+ | Feature work starting from "step-01: project setup" |

The `worktree-*` branches have **no common ancestor** with `main` (`git merge-base` returns empty). They cannot be merged via standard `git merge` — only `--allow-unrelated-histories` or cherry-pick. This is noted on each branch below but is a repository-structure decision for the owner, not a code quality issue.

---

## Branches Reviewed

### 1. `worktree-feat-shop-sales-ai-phase-a`
**Latest commit**: `2749f18e` — fix(shop-ai): switch promptpay-qr to ESM default import  
**Author**: Akenarin Kongdach  
**Last active**: 2026-05-20  
**Size**: ~2609 commits ahead of divergence; new to remote as of today's fetch  
**Scope**: SHOP Sales AI bot — LINE auto-reply, lead capture, PromptPay QR, handoff-to-human

#### Security & Guards
- `ai-settings.controller.ts` — `@UseGuards(JwtAuthGuard, RolesGuard)` ✅ `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')` ✅  
- No new public endpoints (SHOP Bot webhook goes through existing chatcone flow) ✅  
- No hardcoded secrets or API keys ✅

#### Money / Decimal Handling
- `downAmount` in `capture_lead` tool is passed as JS `number` to the external `promptpay-qr` lib (expected by that lib's API). The same `downAmount` is **not** written to any Prisma money column in this code path — the tool only creates a Customer record and returns the QR data URL. No Decimal violation. ✅

#### Frontend Patterns
- `AiSettingsPage.tsx` — uses `api.get/api.post/api.patch` from `@/lib/api` ✅  
- `invalidateQueries` called in all `onSuccess` callbacks ✅ (distinct query keys `['ai-settings','full']` and `['ai-settings','lite']` both invalidated to prevent stale data from the lite/full split)  
- No raw `fetch()` calls found ✅

#### Soft Delete
- All `findMany` / `findFirst` in new services include `deletedAt: null` ✅

#### Issues Found

| # | Severity | File | Issue |
|---|----------|------|-------|
| — | None | — | No critical or blocking issues found |

#### Merge Blocker
This branch has **no common git ancestor with `main`**. Standard `git merge` will refuse unless `--allow-unrelated-histories` is used. Recommend owner decides on integration strategy before attempting merge.

**Verdict**: ✅ **APPROVE** (code quality is clean; merge strategy requires owner decision)

---

### 2. `worktree-feat+sp7.1-dual-prisma-foundation`
**Latest commit**: `73efef41` — ci: nudge PR sync (GitHub webhook stuck)  
**Author**: Akenarin Kongdach  
**Last active**: 2026-05-19  
**Size**: ~2571 commits ahead of divergence; new to remote as of today's fetch  
**Scope**: SP7.1-SP7.10 — Dual Prisma (SHOP + FINANCE as separate DBs), EntityScopeGuard, outbox saga, external finance company/commission CRUD, consolidated reporting, maintenance-mode middleware

#### Security & Guards

All new controllers have proper guards:

| Controller | Guards | Roles |
|-----------|--------|-------|
| `consolidated.controller.ts` (SP7.6) | `JwtAuthGuard, RolesGuard` | `OWNER, ACCOUNTANT` |
| `external-finance.controller.ts` (SP7.4) | `JwtAuthGuard, RolesGuard` | `OWNER, BRANCH_MANAGER, SALES, ACCOUNTANT` |
| `reconcile.controller.ts` (SP7.2) | `JwtAuthGuard, RolesGuard` | `OWNER` |
| `tax.controller.ts` (SP7.5) | `JwtAuthGuard, RolesGuard` | `OWNER, FINANCE_MANAGER, ACCOUNTANT` |
| `health.controller.ts` (SP7.8) — GET / | `@Public()` (intentional probe endpoint) | — |
| `health.controller.ts` — GET /detailed | `JwtAuthGuard, RolesGuard` | `OWNER, FINANCE_MANAGER` |

`EntityScopeGuard` implementation is correct: reads `@Entity()` metadata, checks `user.accessibleCompanies`, throws `ForbiddenException` with Thai message when denied. Falls through (allows) when no `@Entity` decoration present. ✅

#### Money / Decimal Handling

`ExternalFinanceCommission` service correctly wraps DTO numbers with `new Prisma.Decimal()` before any Prisma write:
```ts
financedAmount: new Prisma.Decimal(dto.financedAmount),
commissionRate: new Prisma.Decimal(dto.commissionRate),
commissionAmount: new Prisma.Decimal(dto.financedAmount).mul(...)
```
No precision loss in the DB path. ✅

#### Soft Delete
- `external-finance.service.ts` — `findMany` has `{ deletedAt: null }` ✅  
- `external-finance-commission.service.ts` — `findMany` has `{ deletedAt: null }`, `findFirst` has `{ id, deletedAt: null }` ✅  
- CLI migration scripts (`clone-orig-to-finance`, `extract-shop`) include `{ deletedAt: null }` on all queries ✅

#### Raw SQL
- `$queryRaw` appears in scripts and CLIs only (non-HTTP code paths). All uses are parameterized template literals (`$queryRaw\`SELECT 1\``). No string concatenation. ✅

#### Issues Found

| # | Severity | File | Issue |
|---|----------|------|-------|
| W-1 | **Warning** | `external-finance/dto/commission.dto.ts` | `financedAmount` and `commissionRate` use `@IsNumber()` — these are Decimal(12,2) / Decimal(5,4) in schema. Float input (e.g. `1234.567890`) passes validation but loses precision before `Prisma.Decimal()` wraps it. Recommend changing to `@IsString()` + `@Matches(/^\d+(\.\d{1,2})?$/)` for `financedAmount` and `@Matches(/^\d+(\.\d{1,4})?$/)` for `commissionRate`. Service-level wrapping prevents DB corruption but the DTO doesn't enforce the contract. |
| I-1 | Info | `external-finance/dto/commission.dto.ts` | `financedAmount @IsNumber()` and `commissionRate @IsNumber()` validators have no Thai error messages (`{ message: 'กรุณาระบุ...' }`). Consistent with codebase conventions. |

#### Merge Blocker
Same as above — no common ancestor with `main`. Requires `--allow-unrelated-histories` or cherry-pick.

**Verdict**: ⚠️ **REVIEW** (one Warning on DTO money-field typing; all security gates are in place; merge strategy requires owner decision)

---

### 3. `chore/local-config-sync` — Previously reviewed 2026-06-28
**Verdict**: ✅ APPROVE (unchanged since last run)

### 4. `chore/owner-mobile-settings-bar` — Previously reviewed 2026-06-28
**Verdict**: ✅ APPROVE (unchanged since last run)

---

## Summary

| Branch | Critical | Warning | Info | Verdict |
|--------|----------|---------|------|---------|
| `worktree-feat-shop-sales-ai-phase-a` | 0 | 0 | 0 | ✅ APPROVE |
| `worktree-feat+sp7.1-dual-prisma-foundation` | 0 | 1 | 1 | ⚠️ REVIEW |
| `chore/local-config-sync` | 0 | 0 | 0 | ✅ APPROVE |
| `chore/owner-mobile-settings-bar` | 0 | 0 | 0 | ✅ APPROVE |

## Recommended Action

1. **SP7 W-1** — Fix `commission.dto.ts` to use string-based validators for `financedAmount` and `commissionRate` before merging. The service correctly converts to `Prisma.Decimal` but the DTO should enforce valid decimal format at the boundary.

2. **Merge strategy** — Both `worktree-*` branches have no common ancestor with `main`. Before attempting integration, the owner should decide: cherry-pick the desired commits onto `main`, or rebase the branches to share `main`'s root. The `--allow-unrelated-histories` flag would force a merge but may create a confusing commit graph.
