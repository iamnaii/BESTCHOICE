# Pre-Merge Guard Report — 2026-05-22-v5

**Generated**: 2026-05-22  
**Reviewed branches**: 3 (top-3 by recent commit date, excluding guard/watchdog/reports)

---

## Branch 1: `worktree-feat-installment-calculator`

**Commits**: 26 (feat/refactor/fix/chore/docs/test)  
**Files changed**: 64 (+8,681 / -49)

### Summary
Adds a full customer-facing installment calculator (BC + GFIN) to the product detail page on the web shop, plus a backend `GfinConfigModule` for OWNER-managed rate tables, a public `/shop/installment-preview` endpoint, and a `USE_NEW_RATE_LOOKUP` feature-flagged rate resolution path in `contracts.service.ts` and `sales.service.ts`.

### Issues Found

#### 🔴 Critical — BLOCK

**C1 — `Number()` on `Prisma.Decimal` inside financial calculation paths**

`getRateForMonths()` returns `Promise<Prisma.Decimal>`, but three callers immediately wrap it with `Number()` before using it as a multiplier against the principal:

| File | Pattern |
|------|---------|
| `apps/api/src/modules/contracts/contracts.service.ts` (×2) | `const ratePct = interestConfig ? Number(await getRateForMonths(...)) : ...` — then `roundBaht(principal * ratePct)` |
| `apps/api/src/modules/sales/sales.service.ts` (×1) | Same pattern |

`roundBaht` operates on the result of `principal * ratePct`. Once `ratePct` is a JS `number` (float64), the multiplication is already floating-point — precision loss occurs *before* rounding, not after. For a principal of 50,000 ฿ and a rate like `0.096` (9.6%), float drift is on the order of 0.001–0.01 ฿ but will surface as test failures and inconsistencies with CPA golden-value fixtures.

**Fix**: Keep the value as `Prisma.Decimal` through the multiplication:
```ts
const ratePct = interestConfig
  ? await getRateForMonths(this.prisma, interestConfig.id, dto.totalMonths)
  : new Prisma.Decimal(params.interestRate).mul(dto.totalMonths);
const principalDec = new Prisma.Decimal(dto.sellingPrice - dto.downPayment);
const resolvedInterestTotal = principalDec.mul(ratePct).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
```

**C2 — `Number()` on Decimal config fields in installment-preview calculation**

In `apps/api/src/modules/shop-catalog/installment-preview.service.ts`, the rate resolution for the BC preview path converts Decimal fields to `number` before doing math:

```ts
ratePctByMonths[r.months] = Number(r.ratePct);   // Decimal → float
const rate = Number(cfg.interestRate);             // Decimal → float
minDownPct: Number(cfg.minDownPaymentPct),
commissionPct: Number(cfg.storeCommissionPct),
vatPct: Number(cfg.vatPct),
```

These float values are then passed into `calcBcInstallment` / `calcGfinInstallment` from `packages/shared`. If the shared library uses Decimal internally the input is already contaminated. If it accepts numbers and does its own rounding the calculation is float-based end-to-end — diverging from the CPA-verified golden values.

**Fix**: Pass `Prisma.Decimal` values directly (or call `.toString()` and let the shared library construct its own `Decimal` from the string). If the shared library only accepts `number`, add explicit `Decimal.toDecimalPlaces(6, ROUND_HALF_UP).toNumber()` before passing — at minimum document the precision contract.

---

#### 🟡 Warning

**W1 — Inconsistent serialization pattern: `Number()` vs `.toNumber()`**

`apps/api/src/modules/shop-catalog/shop-catalog.service.ts`:
```ts
cashPrice: product.cashPrice !== null ? Number(product.cashPrice) : null,
installmentPrice: product.installmentPrice !== null ? Number(product.installmentPrice) : null,
```

The project convention (and the pattern used correctly in `installment-preview.service.ts` for response serialization) is `.toNumber()` on `Prisma.Decimal`. `Number()` produces identical output but diverges from convention and makes it harder to grep for the boundary. Use `.toNumber()` here as well.

Similarly in `apps/web/src/utils/getDisplayPrices.ts`:
```ts
if (exact) return Number(exact.amount);
```
Frontend context so precision risk is low, but should be `.toNumber()` for consistency.

**W2 — `installment-preview` endpoint is public (no JwtAuthGuard)**

`ShopCatalogController` uses `@UseGuards(ShopBotDefenseGuard)` only — no JWT. The new `GET /shop/installment-preview` endpoint inherits this. This follows the *existing* pattern for the web shop public catalog (`/shop/products`, `/shop/products/:id`) and appears intentional (customer-facing calculator requires no login).

However the security.md allow-list (`shop/public-config`, `address`, etc.) does not explicitly name `shop-catalog`. Either:
- Add a comment to `security.md` acknowledging `shop-catalog` endpoints are intentionally public, or
- Add `shop-catalog` to the allow-list.

Without documentation this will look like a security bug to the next reviewer.

---

#### 🔵 Info

**I1 — `interestRate` variable declared but not used after refactor in `contracts.service.ts`**

After the refactor:
```ts
const interestRate = params.interestRate; // stored on Contract.interestRate (legacy per-month field — kept as-is)
const ratePct = interestConfig ? ... : params.interestRate * totalMonths;
```
`interestRate` is declared but never used in the update path. TypeScript may warn; a strict build will error.

**I2 — Large new service file**

`apps/api/src/modules/shop-catalog/installment-preview.service.ts` is 201 lines. Acceptable now, but as GFIN logic grows this may warrant splitting BC and GFIN preview into separate services.

**I3 — Feature-flag comment says "Removed in PR 9"**

`apps/api/src/utils/get-rate-for-months.util.ts` has `// Removed in PR 9 once feature flag stable in prod for 2+ weeks.` — this implies a cleanup PR is planned. Fine, but should be tracked as a TODO in the project backlog.

---

### Recommendation: 🔴 BLOCK

Fix C1 and C2 before merge. C1 is in a live financial calculation path that affects contract creation and updates — floating-point drift here will produce amounts that differ from CPA-verified golden values and could mismatch installment schedules. C2 is in the preview path; incorrect preview amounts damage customer trust even if the contract creation path is correct.

---

## Branch 2: `feat/ai-menu-separate`

**Commits**: 4  
**Files changed**: 3 (+12 / -1)

### Summary
Adds `Dashboard` to the OWNER's Finance zone menu config and introduces a `COMMON_PATHS` set in `MainLayout.tsx` to suppress bogus access-denied toasts for universally-accessible routes (e.g. `/`).

### Issues Found

None. The fix is targeted and correct:
- `COMMON_PATHS` short-circuits before the "is this path in any role's sidebar" scan, preventing false `access-denied` toasts when a role's menu config omits a universal route.
- The Dashboard entry in OWNER config is missing — adding it is correct.
- No security, money, or soft-delete concerns.

### Recommendation: ✅ APPROVE

---

## Branch 3: `fix/soften-price-missing`

**Commits**: 1  
**Files changed**: 1 (+30 / -19)

### Summary
Changes `search-products.tool.ts` (sales bot) to return `{ priceMissing: true }` for products without a configured price, instead of silently dropping them. The persona's "no-data → handoff" rule then handles the gap without the bot inventing a price.

### Issues Found

None. The logic is sound:
- Products with a price are returned with `priceThb`.
- Products without a price are returned with `priceMissing: true`.
- The `maxPriceThb` filter correctly keeps `priceMissing` products (they'll sort to the end rather than being excluded).
- The sort correctly places `priceMissing` items last (`Number.MAX_SAFE_INTEGER` sentinel).
- No security, money, or soft-delete concerns.

### Recommendation: ✅ APPROVE

---

## Summary Table

| Branch | Files | Commits | Critical | Warning | Info | Verdict |
|--------|-------|---------|----------|---------|------|---------|
| `worktree-feat-installment-calculator` | 64 | 26 | 2 | 2 | 3 | 🔴 BLOCK |
| `feat/ai-menu-separate` | 3 | 4 | 0 | 0 | 0 | ✅ APPROVE |
| `fix/soften-price-missing` | 1 | 1 | 0 | 0 | 0 | ✅ APPROVE |

## Required Actions Before Merging `worktree-feat-installment-calculator`

1. **C1** — In `contracts.service.ts` and `sales.service.ts`: remove `Number()` wrapper around `getRateForMonths()` return value; keep as `Prisma.Decimal` through the multiplication.
2. **C2** — In `installment-preview.service.ts`: remove `Number()` casts on Decimal config fields used in calculation; use `Prisma.Decimal` arithmetic or at minimum `.toDecimalPlaces(6).toNumber()` with documented precision contract.
3. **W1** (optional but recommended) — Replace `Number(product.cashPrice)` with `.toNumber()` in `shop-catalog.service.ts` and `getDisplayPrices.ts`.
4. **W2** (optional but recommended) — Add `shop-catalog` to the intentionally-public endpoint list in `security.md`.
