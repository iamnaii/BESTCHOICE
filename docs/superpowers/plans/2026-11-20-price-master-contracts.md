# Price master retire — shared contracts for phases 1b, 2, 3, 4

Spec: `docs/superpowers/specs/2026-11-19-price-master-retire-design.md` (phases 1a + 1c shipped in #1798).
All four phases land on branch `feat/price-master-rest`, in order 1b → 2 → 3 → 4. Each phase plan must use
these names exactly. If existing code makes a name impossible, the plan keeps the contract and says why.

## Global constraints (every phase)

- Do not change the BC installment formula, VAT, commission or schedule maths (`calcBcInstallment` body stays as is).
- Percentage-derived down payments round **up** to 100 with `roundUpToStep` / `downFromPct` (`packages/shared/src/installment-rounding.ts`).
  Down payments typed as an amount are never rounded.
- Contract installment keeps satang. Displayed and bot-quoted installments round **up** to whole baht via `displayInstallment`.
- Imported phones and phones with unknown origin get half OVER (`gfinAllowanceFactor`); Thai phones get full OVER.
- Profit is shown only to roles that can see cost. The staff price page never shows cost, profit or GFIN submit price.
- Thai UI copy, `leading-snug` on Thai text, semantic colour tokens only, no `alert`/`confirm`, lucide icons, no emoji.
- `packages/shared` is consumed by the API from `dist` — run `npm run build --workspace=packages/shared` after shared changes.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands: shared `npm --prefix packages/shared test` · web `cd apps/web && npx vitest run <paths>` ·
  api `NODE_OPTIONS=--max-old-space-size=12288 npm --prefix apps/api test -- <paths>` ·
  types `NODE_OPTIONS=--max-old-space-size=12288 ./tools/check-types.sh all`.
- Migrations: Prisma, add-column only, nullable, folder `apps/api/prisma/migrations/<timestamp>_<name>/migration.sql`.

## Phase 1b — GFIN calculator (shared)

`packages/shared/src/installment-calc.types.ts`

```ts
export interface GfinOverpriceRuleRow {
  // …existing fields…
  /** ดาวน์ขั้นต่ำ % ของกลุ่มรุ่นนี้ (เต็มร้อย: 30 = 30%) · null = ใช้ค่าตั้ง gfin.minDownPct */
  minDownPct: number | null;
}
```

`packages/shared/src/installment-calc.ts`

```ts
/** ดาวน์ขั้นต่ำ GFIN เป็นสัดส่วน (0.30) — กติกา OVER ก่อน ไม่มีแล้วใช้ค่าตั้ง (settingMinDownPct เป็นสัดส่วน เช่น 0.25) */
export function resolveGfinDownPct(rule: GfinOverpriceRuleRow | null, settingMinDownPct: Decimal): Decimal;
```

- `calcGfinInstallment`: `downAmountActual = roundUpToStep(max(downAmountByFormula − downDiscount, 0))`. Everything else unchanged
  (`financedAmount` still = submit − `downAmountByFormula`; `shopTotalReceived` uses the rounded `downAmountActual`).
- `findGfinMapping`: if any active mapping row's `modelMatchPattern` equals the product model as a whole name
  (case-insensitive, trimmed — ignoring condition and storage), only rows whose pattern equals the model are eligible;
  none matching condition + storage → `null` (GFIN does not accept). Otherwise the old substring rule.
- DB: `GfinOverpriceRule.minDownPct Int? @map("min_down_pct")`. API DTO + OVER tab field "ดาวน์ขั้นต่ำ %".

## Phase 2 — model quote (shared) + quotes API

`packages/shared/src/installment-rounding.ts`

```ts
/** ค่างวดที่แสดง / ที่บอทบอก — ปัดขึ้นเป็นบาทเต็ม */
export function displayInstallment(amount: Decimal | number): number;
```

`packages/shared/src/model-quote.ts` (exported from `index.ts`)

```ts
export interface ModelQuoteGfinContext {
  mappings: GfinModelMappingRow[];
  rules: GfinOverpriceRuleRow[];
  rateFactors: GfinRateFactorRow[];
  settingMinDownPct: Decimal;   // fraction, e.g. 0.25
  commissionPct: number;        // e.g. 15 (phone) / 5 (tablet)
  contractFee: Decimal;         // e.g. 100
}
export interface ModelQuoteInput {
  product: ProductForGfin;                 // brand, model, storage, category
  deviceOrigin: GfinDeviceOrigin | null;   // null = unknown → half OVER
  cashPrice: number | null;
  bcPrice: number | null;                  // installmentBestchoicePrice (full price)
  financePrice: number | null;             // GFIN sale price (full price); null → bcPrice
  rate1TermMonths?: number | null;
  rate1DownPayment?: number | null;        // fixed amount, not rounded
  rate2TermMonths?: number | null;
  bcConfig: BcConfig | null;               // null → rate1 = null
  gfin: ModelQuoteGfinContext | null;      // null → rate2 unavailable 'NO_CONFIG'
  costPrice?: number | null;               // present → profit fields filled, else null
}
export interface CashQuote { price: number; profit: number | null }
export interface Rate1Quote {
  price: number; downAmount: number; months: number;
  monthlyContract: number;   // satang, from calcBcInstallment
  monthlyDisplay: number;    // displayInstallment(monthlyContract)
  recordedSalePrice: number; // ราคา 2 = floor(down + financed × (1 + commission))
  profit: number | null;
}
export type Rate2Quote =
  | { available: true; salePrice: number; submitPrice: number; downAmount: number; months: number;
      monthly: number; recordedSalePrice: number /* ราคา 3, floor */; profit: number | null;
      originNote: boolean /* true when deviceOrigin is null (half OVER assumed) */ }
  | { available: false; reason: 'NO_PRICE_LIST' | 'NO_RATE' | 'NO_PRICE' | 'NO_CONFIG'; message: string };
export interface ModelQuote { cash: CashQuote | null; rate1: Rate1Quote | null; rate2: Rate2Quote }
export function buildModelQuote(input: ModelQuoteInput): ModelQuote;
```

Rules (spec 4.2–4.4): rate 1 term = template term if allowed, else 12 if allowed, else first allowed. Rate 2 term = template
term, else the OVER rule's `maxMonths`, else 12. Rate 2 down % = `resolveGfinDownPct`. Golden rows = spec 4.5.

API: `GET /pricing-templates/quotes?category=PHONE_NEW|PHONE_USED|TABLET&origin=THAI|IMPORTED&q=<text>` — all roles.

```ts
interface PriceQuoteRow {
  key: string;                       // brand|model|storage|hasWarranty
  brand: string; model: string; storage: string;
  category: 'PHONE_NEW' | 'PHONE_USED' | 'TABLET';
  hasWarranty: boolean | null;       // null = used-phone rows with equal prices merged into one
  cashPrice: number | null;
  rate1: { downAmount: number; monthly: number /* display */; months: number } | null;
  rate2: { downAmount: number; monthly: number; months: number } | { unavailable: string };
}
interface PriceQuoteList { updatedAt: string | null; rows: PriceQuoteRow[] }
```

Service: `PricingQuoteService` in `apps/api/src/modules/pricing-templates/pricing-quote.service.ts`, methods
`listQuotes({ category, origin, q }): Promise<PriceQuoteList>` and
`quoteForModel({ brand, model, storage, category, hasWarranty?, origin }): Promise<ModelQuote | null>` (bot uses this).
No cost/profit/submit price leaves the API through `/quotes`.

## Phase 3 — staff page

Route `/prices`, page `apps/web/src/pages/PriceListPage.tsx` (+ folder `apps/web/src/pages/price-list/` for parts),
consumes `GET /pricing-templates/quotes` only. Menu in `apps/web/src/config/menu.ts` next to คลังสินค้า, all roles.

## Phase 4 — product finance price + price card D

- DB `Product.financePrice Decimal? @db.Decimal(12, 2) @map("finance_price")`; `POST /products` / `PATCH /products/:id` accept `financePrice`.
- Fill on create (all entrances) / reset on re-price per spec 3.2; stock backfill endpoint
  `POST /pricing-templates/backfill-finance-price` with `?dryRun=true` returning `{ count }`.
- Rate-2 readers use `product.financePrice ?? product.installmentPrice`.
- Create-page card computes with `buildModelQuote` client-side from the form's three prices.
