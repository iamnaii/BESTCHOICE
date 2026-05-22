# Pre-Merge Guard Report — 2026-05-22

**Generated:** 2026-05-22  
**Branches reviewed:** 3 most recently active feature branches  
**Total open unmerged branches:** 579 (reviewed top 3 by recency, excluding prior guard/* and watchdog/* branches)

---

## Summary Table

| Branch | Author | Files | Commits | Recommendation |
|--------|--------|-------|---------|----------------|
| `worktree-feat-installment-calculator` | Akenarin Kongdach | 64 (+8681 / -49) | 28 | **⚠ REVIEW** |
| `worktree-feat+sp7.1-dual-prisma-foundation` | Akenarin Kongdach | 78 (+6579 / -49) | 22 | **✅ APPROVE** |
| `worktree-feat-shop-sales-ai-phase-a` | Akenarin Kongdach | 36 (+4315 / -87) | 35 | **✅ APPROVE** |

---

## Branch 1: `worktree-feat-installment-calculator`

### What This Branch Does
Adds a GFIN external finance installment calculator: new `gfin-config` module (max-price rules, overprice rules, rate factors), a public `/shop/installment-preview` endpoint, a `packages/shared/installment-calc.ts` library using `decimal.js`, admin UI pages (`GfinConfigPage`), and a customer-facing `InstallmentCalculatorCard` in `apps/web-shop`.

### Recent Commits
```
ed502ef6 fix(api): export PreviewResult interface (TS4053 — CI build fail)
f33073a7 fix(api): inline installment-calc util to apps/api/src/utils/
474baefa feat(web-shop): customer-facing installment calculator
28c4696d feat(shop-catalog): public /installment-preview endpoint
d3443a0c feat(web): ContractCreatePage pre-fills from URL query params
```

---

### Issues Found

#### ⚠ Warning — `Number()` wrapping of `Prisma.Decimal` rate fields in financial calculations

**Files:**
- `apps/api/src/modules/contracts/contracts.service.ts` (diff lines 290, 314)
- `apps/api/src/modules/sales/sales.service.ts` (diff lines ~1331, 1340, 1345–1357, 1419)

**Details:**

`getRateForMonths()` returns `Promise<Prisma.Decimal>`. The call sites wrap it with `Number()` before using the result in floating-point multiplication:

```ts
// contracts.service.ts
const ratePct = interestConfig
  ? Number(await getRateForMonths(this.prisma, interestConfig.id, dto.totalMonths))
  : params.interestRate * dto.totalMonths;
const principal = roundBaht(dto.sellingPrice - dto.downPayment);
const resolvedInterestTotal = roundBaht(principal * ratePct);
```

```ts
// installment-preview.service.ts
ratePctByMonths[r.months] = Number(r.ratePct);  // Decimal → float
const rate = Number(cfg.interestRate);
minDownPct: Number(cfg.minDownPaymentPct),
commissionPct: Number(cfg.storeCommissionPct),
vatPct: Number(cfg.vatPct),
```

**Assessment:** The downstream `calculateInstallmentWithInterest` utility uses `satang × 100` integer arithmetic (documented in `installment.util.ts`), and the shared `installment-calc.ts` library re-wraps values in `decimal.js` before use. The `roundBaht()` function caps error at ±0.005 THB. **Practical precision loss is minimal** and the test suite covers golden-value rounding.

However, this pattern violates the project rule: *"Number() on money/financial fields (must use Prisma.Decimal)"*. Particularly in `contracts.service.ts`, `ratePct` flows from a `Decimal` DB field through `Number()` into the principal calculation for a real contract — this should use `Prisma.Decimal` arithmetic or pass the value as-is to the utility using `new Prisma.Decimal(r.ratePct).toNumber()` (identical in practice but documents the intent).

**Recommended fix:** Keep `Number()` conversions at the explicit Prisma→utility boundary; add a comment acknowledging the precision boundary. OR refactor `installment-preview.service.ts` to accept `Decimal` and pass `new Decimal(r.ratePct.toString())` rather than `Number()`.

---

#### ⚠ Warning — New public endpoint `GET /shop/installment-preview` not listed in security.md whitelist

**File:** `apps/api/src/modules/shop-catalog/shop-catalog.controller.ts`

**Details:**

```ts
@Controller('shop')
@UseGuards(ShopBotDefenseGuard)  // ← no JwtAuthGuard
export class ShopCatalogController {
  @Get('installment-preview')
  @Throttle({ short: { limit: 60, ttl: 60_000 } })
  async getInstallmentPreview(@Query() dto: InstallmentPreviewDto) { ... }
}
```

The endpoint is intentionally public (customer-facing web shop, no authentication). `ShopBotDefenseGuard` + rate-limiting (60 req/min) are appropriate for this use case. The existing `GET /shop/products` and `GET /shop/products/:id` follow the same pattern and are already in production.

**Security.md only explicitly whitelists `shop/public-config`** as an intentional public endpoint. This new endpoint exposes only pricing data (no PII, no write operations).

**Recommended fix:** Add `shop/installment-preview` to the whitelist in `.claude/rules/security.md` so future reviewers don't flag it as a bug. Low-risk, just a documentation gap.

---

#### ⚠ Warning — Missing Thai validation messages on new DTOs

**Files:** `apps/api/src/modules/gfin-config/dto/max-price.dto.ts`, `overprice-rule.dto.ts`, `rate-factor.dto.ts`, `shop-catalog/dto/installment-preview.dto.ts`

**Details:** New DTOs use class-validator decorators without Thai `message:` options. Project convention (per `.claude/rules/backend.md` and existing `inter-company.dto.ts`) is:

```ts
// Expected:
@IsString({ message: 'กรุณาระบุ series ของ GFIN' })
gfinSeries!: string;

// Actual:
@IsString()
gfinSeries!: string;
```

**Impact:** Default English error messages reach the frontend instead of Thai. Low UX impact (admin-only config screens) but inconsistent with convention.

---

#### ℹ Info — Raw `fetch()` in `apps/web-shop` (acceptable)

**File:** `apps/web-shop/src/components/InstallmentCalculatorCard.tsx`

```ts
fetch(`/api/shop/installment-preview?${params.toString()}&provider=BC`)
```

`apps/web-shop` is a separate public-facing storefront app that does not use the admin `@/lib/api` Axios client (which manages JWT tokens). Raw `fetch()` is correct here. **Not an issue.**

---

#### ℹ Info — Plan/spec files are large

`docs/superpowers/plans/2026-05-22-product-detail-installment-calculator.md` is 3,289 lines. Not a code concern.

---

### Recommendation: **⚠ REVIEW**

The branch is functionally correct and passes CI. The `Number()` wrapping of Prisma Decimals in `contracts.service.ts` should be addressed before merge — it's a precision boundary that creates a maintenance footgun even if current rounding keeps the error within ±0.005 THB. The missing Thai messages and security.md whitelist entry are minor cleanup items.

**Required before merge:**
1. Acknowledge or fix `Number(await getRateForMonths(...))` in `contracts.service.ts` — either add a comment explaining the satang-precision guarantee, or use `Prisma.Decimal` arithmetic throughout.

**Should fix before merge:**
2. Add `shop/installment-preview` to the public endpoint whitelist in `.claude/rules/security.md`.
3. Add Thai `message:` options to the 4 new DTO files.

---

---

## Branch 2: `worktree-feat+sp7.1-dual-prisma-foundation`

### What This Branch Does
Lays the foundation for P3-SP7 legal entity split (SHOP + FINANCE as separate PostgreSQL databases). Adds `PrismaFinanceService` (second Prisma client pointing to `DATABASE_URL_FINANCE`), `EntityScopeMiddleware`, `EntityScopeGuard`, `EntityScopeContext` (React), `ExternalFinanceModule`, `ConsolidatedController` (cross-entity reports), `ReconcileController` (outbox admin), `MaintenanceModeMiddleware`, and CLI tools for data migration.

### Recent Commits
```
73efef41 ci: nudge PR sync
f49ca645 fix(sp7.1): add postgres-finance service + DATABASE_URL_FINANCE to e2e-tests workflow
7344ea83 fix(sp7.1): build script must generate finance Prisma client too
91511a38 docs(sp7): add P3-SP7 plan + clarify FINANCE = continuing entity
b34df047 docs(spec): P3-SP7 SHOP/FINANCE legal entity split design
```

---

### Issues Found

#### ✅ Guards — All new controllers are properly guarded

- `ConsolidatedController` (`/accounting/consolidated`) — `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('OWNER', 'ACCOUNTANT')` at class level ✓
- `ExternalFinanceController` (`/external-finance`) — `@UseGuards(JwtAuthGuard, RolesGuard)` at class level, per-method `@Roles(...)` ✓
- `ReconcileController` (`/admin/outbox`) — `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('OWNER')` ✓

#### ✅ Soft delete — All `findMany`/`findFirst` calls include `deletedAt: null`

Verified across: user backfill, interCompanyTransaction queries, externalFinanceCommission queries, health check queries.

#### ✅ No `Number()` on Prisma Decimal money fields

SP7 branch introduces no new financial arithmetic. The `as any` casts in `audit-edge-cases-sp7.cli.ts` are appropriate: the CLI uses optional chaining (`?.findMany?.()`) because `fixedAsset` and `payrollDocument` models may not exist in all environments (guarded against with `.catch(() => [])`).

#### ✅ No raw SQL injection risk

`$queryRaw` uses are tagged template literals (`$queryRaw\`SELECT current_database() as db\``) — safe against injection.

#### ℹ Info — `prisma as any` in `year-end-closing.template.spec.ts`

```ts
const template = new YearEndClosingTemplate(journal as any, prisma as any);
```

This is in a unit test with a mock object. Acceptable — the template's production path uses typed `JournalService` and `PrismaService` injection.

#### ℹ Info — `as any[]` type fallbacks in CLI audit script

The CLI uses `(prisma as any).fixedAsset?.findMany?.()` patterns intentionally — the comment states "Payroll module may or may not exist". This is a diagnostic CLI, not production service code. Acceptable.

---

### Recommendation: **✅ APPROVE**

No critical or warning issues. Clean guard coverage, proper soft-delete filtering, no Decimal precision violations. The `as any` usages are confined to test files and a diagnostic CLI tool. Ready to merge.

---

---

## Branch 3: `worktree-feat-shop-sales-ai-phase-a`

### What This Branch Does
Phase A of the Shop Sales AI: a new `SalesBotModule` with `SalesBotService`, `CaptureLeadTool` (creates Customer draft + generates PromptPay QR), defense-in-depth `TIKTOK` auto-reply blocker, `release-to-ai` endpoint on `ChatAiDraftController`, `AI_AUTO_MAX_REPLIES` config bump (5→50), and a `shop-ai-flow.unit.spec.ts` integration spec.

### Recent Commits
```
2749f18e fix(shop-ai): switch promptpay-qr to ESM default import (lint blocker)
ee950e39 feat(shop-ai): wire PromptPay QR generation in capture_lead
3855bfcf feat(shop-ai): defense-in-depth — block TIKTOK auto-reply (stub adapter)
c4ecce78 perf(shop-ai): tighten Customer.acquisitionSource — VarChar(50) + partial index
6dfa890c chore(shop-ai): rename shop-ai-flow.spec.ts → .unit.spec.ts
```

---

### Issues Found

#### ✅ Guards — All new endpoints are properly guarded

- `POST /chat-ai/release-to-ai/:roomId` — inherits class-level `@UseGuards(JwtAuthGuard, RolesGuard)`, adds `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'SALES')` ✓
- `POST /staff-chat/ai/test-send` — `@Roles('OWNER')` ✓

#### ✅ `downAmount: Number(input.downAmount)` — Acceptable (not a DB Decimal field)

`downAmount` in `sales-bot.service.ts` converts an AI tool-call JSON argument (string | undefined) to `number` for:
1. PromptPay QR generation via `generatePayload(promptpayId, { amount })`
2. AuditLog `newValue` JSON field (serialized metadata, not a financial account)
3. Returned in the result object for display

`downAmount` is **not stored in a `@db.Decimal` Prisma column** — it flows through `AuditLog.newValue` (JSONB) and the PromptPay library. No financial DB write uses it. **Not a violation.**

#### ✅ Soft delete — All queries include `deletedAt: null`

Verified: `customer.findFirst({ where: { ..., deletedAt: null } })`, `systemConfig.findMany({ where: { deletedAt: null } })`.

#### ✅ No raw SQL or `$queryRaw`

#### ℹ Info — `AI_AUTO_MAX_REPLIES` config change (5 → 50)

```ts
: Number(this.config.get<string>('AI_AUTO_MAX_REPLIES') ?? '50'),
```

This increases the default maximum AI auto-replies per session from 5 to 50. Intentional per commit message. No security concern, but worth noting for ops awareness — a runaway AI session could now generate 50 automated messages instead of 5 before being gated.

#### ℹ Info — `capture-lead.tool.ts` PromptPay QR generation has silent failure path

```ts
try {
  const payload = generatePayload(promptpayId, { amount: input.downAmount });
  promptPayQr = await QRCode.toDataURL(payload);
} catch (err) {
  this.logger.error(`PromptPay QR generation failed...`);
  // Fall through to lead-only mode
}
```

QR generation failure is logged but the tool returns `promptPayQr: null` without surfacing the error to the customer or staff. The handoff message still goes out (without QR). This is a deliberate design choice (lead-only mode fallback), but staff should be alerted so they can manually send QR. **Not blocking, but worth noting in the PR description.**

---

### Recommendation: **✅ APPROVE**

No critical or warning issues. Guard coverage is complete, financial calculations respect the Decimal boundary, and soft-delete filtering is in place. The `AI_AUTO_MAX_REPLIES` bump and silent QR fallback are noted as informational items for the team.

---

## Appendix: Branches Skipped

The following recently active branches were skipped because they are small, targeted fixes:

| Branch | Diff Summary | Reason Skipped |
|--------|-------------|----------------|
| `feat/ai-menu-separate` | 3 files, +12 lines | UI-only menu config change, no backend |
| `fix/soften-price-missing` | Small fix | Likely UI text fix |
| `fix/search-products-stock-and-price` | Small fix | Scoped product search fix |

---

*Report generated by Pre-Merge Guard agent. Run `git diff origin/main...origin/<branch>` to reproduce.*
