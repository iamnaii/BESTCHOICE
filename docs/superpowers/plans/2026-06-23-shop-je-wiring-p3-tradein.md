# SHOP-side JE Wiring — P3 (ShopTradeIn) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Post a SHOP journal entry when a **BUYBACK** trade-in is accepted (the shop buys a used device for cash), so used-device purchases hit `/shop/accounting`.

**Architecture:** At `TradeInLifecycleService.accept()`, when `tradeIn.flow === 'BUYBACK'`, post `ShopTradeInTemplate` inside the existing accept `$transaction` — `Dr S11-2002 (used inventory) / Cr cash` for the buy price. Cash is an **outflow** (paying the seller), routed via a new `ShopAccountResolver.resolveOutflowCashAccount` (CASH→branch till, TRANSFER→S11-1202 paying bank). Reuses the P1 `ShopAccountResolver` + the already-built `ShopTradeInTemplate`.

**Tech Stack:** NestJS, Prisma (PostgreSQL), TypeScript, jest (`--runInBand`).

**Spec:** `docs/superpowers/specs/2026-06-23-shop-je-wiring-design.md` (§6 ShopTradeIn + §5B cash routing).

**Depends on P0+P1** (`ShopAccountResolver`, X5) — PR #1280 — and reuses P2's branch. **Branch P3 off `feat/shop-cash-sale`** (which carries resolver + X5 + P2); rebase onto `main` after #1280/#1281 merge. **Do not merge before #1280.**

## SCOPE DECISION (resolved during planning): BUYBACK only

`TradeIn.flow` is `EXCHANGE | BUYBACK`:
- **BUYBACK** = pure cash-out (shop buys a used phone for cash → into stock). `Dr S11-2002 / Cr cash` is exactly right. **← P3 wires this.**
- **EXCHANGE** = the used device is traded toward a *new purchase*; its value is a **credit against that sale/contract**, not a cash payout. Crediting `cash` for an EXCHANGE would be wrong — the offset belongs in the companion sale/contract JE. **EXCHANGE is DEFERRED** (own design: thread the trade-in credit into the sale/contract posting). The existing `ShopExchangeReturnTemplate` handles the *contract-exchange* device re-intake, a different flow.

`accept()` already **requires `branchId` non-null** (`trade-in-lifecycle.service.ts:347`) and validates TRANSFER bank fields — so the cash-routing inputs are guaranteed present.

## Global Constraints

- **Atomic:** `ShopTradeInTemplate.execute(..., tx)` uses the accept `$transaction` tx; a JE failure rolls back the whole accept.
- **BUYBACK only:** post **only** when `tradeIn.flow === 'BUYBACK'`; skip EXCHANGE entirely.
- **Buy price = `costPrice`** (`tradeIn.offeredPrice ?? estimatedValue ?? 0`, the value already computed in accept() and used as the new Product's cost) → `tradeInPrice`. Skip the JE if `costPrice <= 0` (template requires `> 0`; a 0-price buyback is degenerate, don't block accept).
- **Inventory account:** default `S11-2002` (sellable used) — don't pass `inventoryAccountCode` (the template defaults it).
- **Cash routing:** `paymentMethod === 'CASH'` → branch till (`resolveBranchCashAccount`, fail-closed); else (`'TRANSFER'`/null) → `S11-1202` (`SHOP_PAYING_BANK`). `TradeIn.paymentMethod` is a **string** (`'CASH'|'TRANSFER'`), not the `PaymentMethod` enum.
- **Idempotency key:** `shop-trade-in:<tradeInId>` (the template self-dedupes on `metadata.flow` + `idempotencyKey`).
- **Money:** `Decimal` only; never `Number()`. **DI fan-out:** adding required ctor deps to `TradeInLifecycleService` — update every TestingModule that constructs it (grep `rg -l "TradeInLifecycleService" apps/api/src -g'*.spec.ts'`) and run the whole `src/modules/trade-in` suite.
- **Test runner:** `npm --prefix apps/api test -- <spec>` (repo root; `--runInBand`). Output pristine.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `apps/api/src/modules/journal/shop-account-resolver.service.ts` (modify) | add `resolveOutflowCashAccount(branchId, paymentMethod, tx?)` | 1 |
| `apps/api/src/modules/journal/shop-account-resolver.service.spec.ts` (modify) | outflow-routing tests | 1 |
| `apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.ts` (modify `accept()` ~:325-420 + ctor ~:29) | post ShopTradeIn for BUYBACK | 2 |
| `apps/api/src/modules/trade-in/trade-in.module.ts` (modify) | import `JournalModule` | 2 |
| `apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.spec.ts` (create) | accept-BUYBACK wiring tests | 2 |

---

## Task 1: `ShopAccountResolver.resolveOutflowCashAccount`

**Files:**
- Modify: `apps/api/src/modules/journal/shop-account-resolver.service.ts`
- Test: `apps/api/src/modules/journal/shop-account-resolver.service.spec.ts`

**Interfaces:**
- Consumes: existing `resolveBranchCashAccount(branchId, tx?)` + `SHOP_PAYING_BANK` ('S11-1202').
- Produces: `resolveOutflowCashAccount(branchId: string, paymentMethod: string | null | undefined, tx?: Prisma.TransactionClient): Promise<string>`

- [ ] **Step 1: Add the failing tests** to `shop-account-resolver.service.spec.ts`:

```typescript
it('resolveOutflowCashAccount: CASH → the branch till', async () => {
  prisma.branch.findUnique.mockResolvedValue({ shopCashAccountCode: 'S11-1102' });
  await expect(resolver.resolveOutflowCashAccount('br-1', 'CASH')).resolves.toBe('S11-1102');
});

it('resolveOutflowCashAccount: TRANSFER / null → the paying bank S11-1202', async () => {
  await expect(resolver.resolveOutflowCashAccount('br-1', 'TRANSFER')).resolves.toBe('S11-1202');
  await expect(resolver.resolveOutflowCashAccount('br-1', null)).resolves.toBe('S11-1202');
  expect(prisma.branch.findUnique).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run — expect FAIL** (method undefined).

Run: `npm --prefix apps/api test -- src/modules/journal/shop-account-resolver.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — add to `ShopAccountResolver` (note: `paymentMethod` is a plain string here, because `TradeIn.paymentMethod` is `String?` `'CASH'|'TRANSFER'`, unlike the `PaymentMethod`-enum `resolveInflowCashAccount`):

```typescript
/**
 * Resolve the SHOP cash/bank account that FUNDS an outflow (trade-in payout, branch
 * expense). CASH → the branch's physical till (fail-closed); any non-cash method
 * (transfer) → the single SHOP paying bank S11-1202 (spec §5B).
 */
async resolveOutflowCashAccount(
  branchId: string,
  paymentMethod: string | null | undefined,
  tx?: Prisma.TransactionClient,
): Promise<string> {
  if (paymentMethod === 'CASH') {
    return this.resolveBranchCashAccount(branchId, tx);
  }
  return ShopAccountResolver.SHOP_PAYING_BANK;
}
```

- [ ] **Step 4: Run — expect PASS** (existing 6 + 2 new).

Run: `npm --prefix apps/api test -- src/modules/journal/shop-account-resolver.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/modules/journal/shop-account-resolver.service.ts apps/api/src/modules/journal/shop-account-resolver.service.spec.ts
git commit -m "feat(journal): ShopAccountResolver.resolveOutflowCashAccount (CASH→till, else→paying bank)"
```

---

## Task 2: Wire `ShopTradeInTemplate` at `accept()` (BUYBACK only)

**Files:**
- Modify: `apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.ts` (ctor ~:29 + `accept()` tail ~:411-420)
- Modify: `apps/api/src/modules/trade-in/trade-in.module.ts` (add `JournalModule` import)
- Test: `apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.spec.ts` (create)

**Interfaces:**
- Consumes: `ShopTradeInTemplate.execute(input: { idempotencyKey, tradeInId, tradeInNumber?, cashAccountCode, tradeInPrice: Decimal, inventoryAccountCode?, postedAt? }, outerTx?): Promise<{entryNo,journalEntryId}>`; `ShopAccountResolver.resolveOutflowCashAccount(branchId, paymentMethod, tx)`.

- [ ] **Step 1: Write the failing tests** (`trade-in-lifecycle.service.spec.ts`). Build a `TestingModule` providing `TradeInLifecycleService` with ALL its ctor deps mocked (read the ctor — prisma, storage, voucher, contactResolver, pii, query, valuation, … + the two new ones). `prisma.$transaction = jest.fn(async (cb) => cb(tx))`; `tx` exposes `tradeIn.findUnique`/`tradeIn.update`, `product.create`, `product.findFirst`. Assert:

```typescript
it('posts ShopTradeIn (Dr S11-2002 / Cr cash) for a BUYBACK accept (CASH → till)', async () => {
  tx.tradeIn.findUnique.mockResolvedValue({
    id: 'ti-1', status: 'APPRAISED', deletedAt: null, flow: 'BUYBACK',
    branchId: 'br-1', offeredPrice: new Decimal(5000), estimatedValue: null, imei: null,
    deviceBrand: 'Apple', deviceModel: 'iPhone 12', deviceColor: null, deviceStorage: null,
    deviceCondition: 'A', notes: null,
  });
  tx.product.create.mockResolvedValue({ id: 'p-new' });
  tx.tradeIn.update.mockResolvedValue({ id: 'ti-1', status: 'ACCEPTED' });
  shopAccountResolver.resolveOutflowCashAccount.mockResolvedValue('S11-1102');
  await service.accept('ti-1', { idCardVerified: true, sellerConsentSigned: true, paymentMethod: 'CASH' } as any, 'u-1');
  expect(shopTradeInTemplate.execute).toHaveBeenCalledTimes(1);
  const input = shopTradeInTemplate.execute.mock.calls[0][0];
  expect(input).toMatchObject({ idempotencyKey: 'shop-trade-in:ti-1', tradeInId: 'ti-1', cashAccountCode: 'S11-1102' });
  expect(input.tradeInPrice.toString()).toBe('5000');
  expect(input.inventoryAccountCode).toBeUndefined(); // defaults to S11-2002
  expect(shopTradeInTemplate.execute.mock.calls[0][1]).toBeDefined(); // tx passed
});

it('does NOT post ShopTradeIn for an EXCHANGE accept', async () => {
  tx.tradeIn.findUnique.mockResolvedValue({ id: 'ti-2', status: 'APPRAISED', deletedAt: null, flow: 'EXCHANGE', branchId: 'br-1', offeredPrice: new Decimal(5000), estimatedValue: null, imei: null, deviceBrand: 'A', deviceModel: 'B', deviceColor: null, deviceStorage: null, deviceCondition: null, notes: null });
  tx.product.create.mockResolvedValue({ id: 'p-2' });
  tx.tradeIn.update.mockResolvedValue({ id: 'ti-2' });
  await service.accept('ti-2', { idCardVerified: true, sellerConsentSigned: true, paymentMethod: 'CASH' } as any, 'u-1');
  expect(shopTradeInTemplate.execute).not.toHaveBeenCalled();
});

it('routes a BUYBACK TRANSFER payout to the paying bank S11-1202', async () => {
  tx.tradeIn.findUnique.mockResolvedValue({ id: 'ti-3', status: 'APPRAISED', deletedAt: null, flow: 'BUYBACK', branchId: 'br-1', offeredPrice: new Decimal(3000), estimatedValue: null, imei: null, deviceBrand: 'A', deviceModel: 'B', deviceColor: null, deviceStorage: null, deviceCondition: null, notes: null });
  tx.product.create.mockResolvedValue({ id: 'p-3' });
  tx.tradeIn.update.mockResolvedValue({ id: 'ti-3' });
  shopAccountResolver.resolveOutflowCashAccount.mockResolvedValue('S11-1202');
  await service.accept('ti-3', { idCardVerified: true, sellerConsentSigned: true, paymentMethod: 'TRANSFER', transferBankName: 'KBank', transferAccountNumber: '123', transferAccountName: 'X' } as any, 'u-1');
  expect(shopAccountResolver.resolveOutflowCashAccount).toHaveBeenCalledWith('br-1', 'TRANSFER', tx);
  expect(shopTradeInTemplate.execute.mock.calls[0][0].cashAccountCode).toBe('S11-1202');
});
```

> Provide every ctor dep as a minimal mock (mirror `contract-exchange.service.spec.ts` setup). `import { Decimal } from '@prisma/client/runtime/library'`.

- [ ] **Step 2: Run — expect FAIL.**

Run: `npm --prefix apps/api test -- src/modules/trade-in/services/trade-in-lifecycle.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** Add imports + two required ctor params:

```typescript
import { ShopTradeInTemplate } from '../../journal/cpa-templates/shop-trade-in.template';
import { ShopAccountResolver } from '../../journal/shop-account-resolver.service';
// in the constructor (append; required, no @Optional):
//   private shopTradeInTemplate: ShopTradeInTemplate,
//   private shopAccountResolver: ShopAccountResolver,
```

Replace the `accept()` tail (`return tx.tradeIn.update({...})`) — capture it, post the BUYBACK JE, then return:

```typescript
      const updated = await tx.tradeIn.update({
        where: { id },
        data: {
          status: 'ACCEPTED',
          agreedPrice: tradeIn.offeredPrice,
          productId: product.id,
          idCardVerifiedAt: new Date(),
          idCardVerifiedById: userId,
          sellerConsentSigned: true,
          // ...KEEP the rest of the existing update payload exactly (paymentMethod,
          //    transferBankName/AccountNumber/AccountName, signature, etc.)...
        },
      });

      // SHOP-side: a BUYBACK buys the used device for cash → Dr S11-2002 / Cr cash.
      // EXCHANGE is intentionally skipped: its value is credited toward a purchase and is
      // booked with the companion sale/contract, not as a standalone cash-out (deferred).
      if (tradeIn.flow === 'BUYBACK' && costPrice.gt(0)) {
        const cashAccountCode = await this.shopAccountResolver.resolveOutflowCashAccount(
          tradeIn.branchId,
          dto.paymentMethod,
          tx,
        );
        await this.shopTradeInTemplate.execute(
          {
            idempotencyKey: `shop-trade-in:${tradeIn.id}`,
            tradeInId: tradeIn.id,
            cashAccountCode,
            tradeInPrice: costPrice,
          },
          tx,
        );
      }

      return updated;
```

> `costPrice` is the `Prisma.Decimal` already computed at `:387` (`tradeIn.offeredPrice ?? estimatedValue ?? 0`). `tradeIn.branchId` is guaranteed non-null (guard at `:347`). Keep the existing `tx.tradeIn.update` payload byte-for-byte — only restructure `return X` → `const updated = X; … ; return updated`.

- [ ] **Step 4: Wire DI.** Add `JournalModule` to `trade-in.module.ts` `imports` (`import { JournalModule } from '../journal/journal.module';`) so the resolver + template (both exported by JournalModule) inject. Check for a SalesModule↔ cycle — JournalModule imports only PrismaModule, so no cycle. Then `rg -l "TradeInLifecycleService" apps/api/src -g'*.spec.ts'` — if any spec (or a TradeInService facade spec) constructs it, add `{ provide: ShopTradeInTemplate, useValue: { execute: jest.fn() } }` + `{ provide: ShopAccountResolver, useValue: { resolveOutflowCashAccount: jest.fn() } }` to its providers.

- [ ] **Step 5: Run — expect PASS** (whole trade-in suite) + typecheck.

Run: `npm --prefix apps/api test -- src/modules/trade-in && (cd apps/api && npx tsc --noEmit -p tsconfig.json)`
Expected: all trade-in suites PASS; tsc exit 0.

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.ts apps/api/src/modules/trade-in/trade-in.module.ts apps/api/src/modules/trade-in/services/trade-in-lifecycle.service.spec.ts
git commit -m "feat(trade-in): post ShopTradeIn JE on BUYBACK accept (Dr S11-2002 / Cr cash)"
```

---

## Acceptance
- `apps/api` tsc 0; full `src/modules/trade-in` suite green; resolver spec green.
- A BUYBACK accept (CASH) posts one balanced JE Dr S11-2002 / Cr branch-till for the buy price; TRANSFER routes Cr to S11-1202. An EXCHANGE accept posts no SHOP JE. Re-accepting the same trade-in id doesn't double-post (idempotency `shop-trade-in:<id>`).

## Out of scope / deferred
- **EXCHANGE trade-ins** — the trade-in value is a credit toward a purchase; its SHOP accounting must be threaded into the companion sale/contract JE, not a standalone cash-out. Needs its own design (owner/accountant) once the EXCHANGE→sale linkage is modeled. Until then EXCHANGE accepts post no SHOP JE (the device still enters stock via the existing `product.create`).
- S11-2004 (pending-eval) staging inventory — `accept()` is the appraised+accepted point, so the device goes straight to sellable S11-2002; the pending-eval stage isn't modeled here.
