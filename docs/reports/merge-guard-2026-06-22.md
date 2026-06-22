# Merge Guard Report — 2026-06-22

**Scope**: Open GitHub PRs + 2 active worktree branches  
**Branches reviewed**: 3 (PR #1150 + 2 worktree branches)  
**Run time**: 2026-06-22 UTC

---

## Summary

| Branch | Status | Recommendation |
|--------|--------|----------------|
| PR #1150 `feat/contacts-audit-cleanup` | Superseded by #1266 | **CLOSE** (stale) |
| `worktree-feat+sp7.1-dual-prisma-foundation` | Active dev, large | **REVIEW** (Warning-level findings) |
| `worktree-feat-shop-sales-ai-phase-a` | Active dev, large | **APPROVE** (no blocking issues) |

---

## PR #1150 — `feat/contacts-audit-cleanup`

**Author**: iamnaii  
**Created**: 2026-06-04  
**Last updated**: 2026-06-22  
**Unique delta**: 1 commit (`2d3f7428`) — 6 files, 55 insertions, 8 deletions

### Context

The PR's sole change — surfacing `sellerName`/`sellerPhone` in the `TradeInTile` component + 2 test cases — was already re-implemented in main as PR #1266 (`25986123`), which itself states:

> "Re-applies the intent of the stale PR #1150 cleanly on top of the post-refactor TradeInTile component."

The feature branch sits 153 commits behind main (the branch diverged when main was still at `3ad5e99c`). The code diff between the branch HEAD and current main is 777 files / ~298 k line delta — almost entirely because main moved forward without this branch tracking it.

### Issues Found: NONE

The single delta commit itself is clean:
- No security issues
- No money precision violations  
- Proper test coverage for both new display scenarios

### Recommendation: **CLOSE** as superseded

```
Close PR #1150 with note: "Feature landed via #1266. Branch is 153 commits stale."
```

---

## `worktree-feat+sp7.1-dual-prisma-foundation`

**Description**: SP7.1 — dual Prisma Foundation (SHOP DB split) + accounting reports overhaul  
**Size**: 1351 files changed vs main (active development branch, not a PR yet)  
**New controllers**: `DraftsController`, `QuotesController`, `TwoFactorController`, `ConsolidatedController`

### File Changes Summary

- 767 TypeScript source files changed
- New modules: `drafts/`, `quotes/`, `two-factor/`, `consolidated/`, `data-audit/`, `ai-settings/`
- New CLI scripts: `extract-shop-from-finance.cli.ts`, `backfill-*` (×6)

### Critical Issues: NONE

All new controllers are properly guarded:

| Controller | JwtAuthGuard | RolesGuard | @Roles |
|------------|:---:|:---:|:---:|
| `DraftsController` | ✓ class | ✓ class | ✓ per-method |
| `QuotesController` | ✓ class | ✓ class | ✓ per-method |
| `TwoFactorController` | ✓ class | — | — (self-service; role-agnostic by design) |
| `ConsolidatedController` | ✓ class | ✓ class | ✓ class (`OWNER`, `ACCOUNTANT`) |

No hardcoded secrets, no `queryRawUnsafe`, no `$queryRaw` with string concatenation.

### Warning Issues

#### W-1: `Number()` on Decimal debit/credit in `data-audit.service.ts` (new code)

```ts
// apps/api/src/modules/data-audit/data-audit.service.ts (new additions)
const totalDebit = activationJournal.lines.reduce((sum, l) => sum + Number(l.debit), 0);
const totalCredit = activationJournal.lines.reduce((sum, l) => sum + Number(l.credit), 0);
// ... repeated for cogsJournal and other JEs
const journalHp = hpLines.reduce((sum, l) => sum + Number(l.debit) - Number(l.credit), 0);
```

These reduce journal lines using `Number()` conversion + JS floating-point addition. For an audit/data-integrity service, accumulating IEEE-754 floats across many lines is an inaccurate foundation for a balance check — a large journal entry with fractional baht amounts may pass the check at 0.001 tolerance but would fail a Prisma.Decimal comparison. Should use `Prisma.Decimal` reduction instead.

**Fix**:
```ts
import { Prisma } from '@prisma/client';
const totalDebit = activationJournal.lines.reduce(
  (sum, l) => sum.add(l.debit),
  new Prisma.Decimal(0)
);
```

#### W-2: `amount: Number(q.total)` in `drafts.service.ts` (new code)

```ts
// apps/api/src/modules/drafts/drafts.service.ts
amount: Number(q.total),   // Quote
amount: Number(c.financedAmount),  // Contract
amount: Number(e.totalAmount),     // Expense
amount: Number(oi.totalAmount),    // OtherIncome
```

These are for a display-only Drafts hub (federated list of DRAFT docs), so precision loss is low-risk. However, to stay consistent with the project's `Prisma.Decimal` conventions and avoid downstream misuse, these should use `.toNumber()` (which signals intent) or be typed as `Prisma.Decimal` in the response type.

### Info Issues

#### I-1: `TwoFactorController` missing `RolesGuard`

`@UseGuards(JwtAuthGuard)` only — no `RolesGuard`/`@Roles()`. This is intentional since 2FA enrollment is self-service for any authenticated user, but it departs from the standard class-level guard pattern. A `@Roles('OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'FINANCE_MANAGER', 'SALES')` (all roles) would make the intent explicit without changing behavior.

#### I-2: `ConsolidatedController` methods missing per-method `@Roles()`

All methods rely on the class-level `@Roles('OWNER', 'ACCOUNTANT')`. This is valid (NestJS applies class-level decorators to all methods) but differs from the project standard of repeating `@Roles()` per method. No behavioral issue.

---

## `worktree-feat-shop-sales-ai-phase-a`

**Description**: Shop AI Sales Bot (LINE/Facebook/TikTok auto-reply)  
**Size**: 1224 files changed vs main (active development branch, not a PR yet)

### Critical Issues: NONE

### Warning Issues: NONE

### Info Issues

#### I-1: `@Roles('OWNER', 'VIEWER')` on `GET /period-status` (accounting controller)

The `VIEWER` role appears in 18 places in `accounting.controller.ts`. The schema comment says "NO @Roles() decorator includes VIEWER by default. Activation gate: SystemConfig key `viewer_role_enabled`."

**Verified safe**: The `RolesGuard` itself implements the SystemConfig gate — when `viewer_role_enabled = 'false'` (default), VIEWER requests are denied even if `@Roles()` includes VIEWER. The guard caches the flag for 60s. This is correct behavior; the comment describes the gate mechanism, not a missing guard.

#### I-2: Raw `fetch()` for S3 presigned URL upload

One `fetch()` call exists in a new page component for uploading directly to a presigned S3 URL. This is the correct pattern (the api client cannot forward raw binary streams to an external S3 endpoint). Not a violation.

#### I-3: `GET /ai-settings/persona` exposes full system prompt text

`AiSettingsController.getPersona()` returns `SALES_BOT_SYSTEM_PROMPT` and `FINANCE_BOT_SYSTEM_PROMPT` in the response body, accessible to `OWNER`, `BRANCH_MANAGER`, and `FINANCE_MANAGER`. This is intentional (admin transparency) but worth an explicit owner sign-off if the prompts contain proprietary jailbreak-resistant instructions.

---

## Actions Required Before Merge

| Priority | Action | Target |
|----------|--------|--------|
| Close PR | Close #1150 as stale/superseded by #1266 | iamnaii |
| Warning | Fix `Number()` → `Prisma.Decimal` in `data-audit.service.ts` reduce loops | sp7.1 branch |
| Info | Replace `Number(q.total)` with `.toNumber()` in drafts.service.ts for consistency | sp7.1 branch |

No BLOCK-level issues found. SP7.1 needs Warning fixes before PR is raised. Shop AI branch is clean.
