# Merge Guard Report — feat/accounting-phase-a1b-intercompany-je

**Date**: 2026-05-02
**Branch**: `feat/accounting-phase-a1b-intercompany-je`
**Author**: iamnaii@MacBook-Pro-khxng-Akenarin.local
**Reviewed by**: Pre-Merge Guard Agent (automated)

---

## Summary

23 files changed — +3835 / -181 lines.

This branch implements Phase A.1b of the inter-company journal split: contract activation now
posts **paired SHOP+FINANCE journal entries** instead of a single FINANCE-side entry (Phase A.1a).
It also adds:
- Bad Debt Provision JE (delta-based, non-blocking)
- Repossession Resale JE
- `inter-company-link.util.ts` — UUID-based description linking of paired JEs

Key changed files:
- `journal-auto.service.ts` (+665/-? lines — largest single change)
- `bad-debt.service.ts` — delta provision logic
- `repossessions.service.ts` — resale JE hook after SOLD transition
- `contract-workflow.service.ts` / `contract-payment.service.ts` — SHOP+FINANCE companyId threading
- `data-audit.service.ts` — orphan-contract repair path updated
- Seeds: `chart-of-accounts.ts` / `chart-of-accounts-finance.ts` — SHOP extra accounts

---

## Issues by Severity

### Critical — None

No missing `@UseGuards`, no bare `Number()` on stored financial values, no unparameterized
`$queryRaw`, no hardcoded secrets.

### Warning — 2 issues

**W1 — `Number(repo.resellPrice)` as intermediate before `new Prisma.Decimal()`**

File: `apps/api/src/modules/repossessions/repossessions.service.ts`

```typescript
// Current
const resellPrice = new Prisma.Decimal(
  dto.resellPrice ?? Number(repo.resellPrice ?? 0),
);
```

`repo.resellPrice` is a `Decimal` field. Converting it through `Number()` first introduces a
floating-point intermediary. A large Decimal value (e.g. `99999999.99`) could lose precision
before being wrapped back in `Decimal`.

**Fix**: pass the Decimal directly:
```typescript
const resellPrice = new Prisma.Decimal(dto.resellPrice ?? repo.resellPrice ?? 0);
```
`Prisma.Decimal` constructor accepts `Decimal | number | string` — no intermediate `Number()` needed.

---

**W2 — `as unknown as { costPrice?: ... }` cast on `repo.product`**

File: `apps/api/src/modules/repossessions/repossessions.service.ts`

```typescript
const costPrice = new Prisma.Decimal(
  (repo.product as unknown as { costPrice?: number | Prisma.Decimal })?.costPrice ?? 0,
);
```

This double-cast via `unknown` suggests `repo.product` lacks a proper TypeScript type in this
context. The implicit `?? 0` fallback means a missing `costPrice` silently produces a zero
`bookValue` — which would create a misleading journal entry (100% profit on a repossession).

**Fix**: verify `repossession.service.ts#findOne` always includes `product: { select: { costPrice: true } }`,
then type the local `repo` variable appropriately (or assert non-null on `costPrice`).

---

### Info — 1 item

**I1 — Large `journal-auto.service.spec.ts` (+796 lines)**

The spec file is now very large. Not a blocker but consider splitting into
`journal-auto.activation.spec.ts` / `journal-auto.payment.spec.ts` in a follow-up.

---

## Security Check

- Controller guards: no new controllers added — existing `repossessions.controller.ts` already has
  class-level `@UseGuards(JwtAuthGuard, RolesGuard)`. New `@CurrentUser()` injection is safe.
- No raw SQL / `$queryRaw` introduced.
- No secrets or hardcoded keys.

---

## Recommendation

**REVIEW** — Merge after W1 is fixed. W2 is lower priority but worth addressing to prevent silent
zero-bookValue journals on repossession resales with missing `costPrice` data.

No Critical blockers. The accounting logic (paired SHOP+FINANCE entries, delta-based provision
JEs, IC-link UUIDs) follows the A.1b spec correctly.
